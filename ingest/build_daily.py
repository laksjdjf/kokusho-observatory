#!/usr/bin/env python3
"""build_daily.py — obsdl から官署の日別最高気温(daily_max)を全期間取り込み、
SQLite (data/max_temp.sqlite) を構築する。Phase 1 の中核。

- 地点は data/stations.json（build_data.py --with-stations が生成した官署）から読む。
- 各地点を obsdl で取得（1リクエスト上限 ~44000日 なので、長い歴史は
  40000日ごとにチャンク分割）。fetch_obsdl_sample.py の関数を再利用。
- 取得した daily_max と stations を SQLite に投入し、インデックスを張る。

使い方:
    uv run python build_daily.py --limit 3     # 先頭3地点だけ（動作テスト）
    uv run python build_daily.py               # 全官署
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
import fetch_obsdl_sample as obsdl

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STATIONS_JSON = DATA_DIR / "stations.json"
DB_PATH = DATA_DIR / "max_temp.sqlite"

HISTORY_START = date(1872, 1, 1)   # 気象官署の最古（東京 1872）に合わせた下限
CHUNK_DAYS = 40000                  # 44000セル制限に対する安全マージン

SCHEMA = """
CREATE TABLE stations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  jma_code   TEXT NOT NULL UNIQUE,
  amedastable_code TEXT,   -- 実況CSV(mdrr)の観測所番号。当日速報の突合に使う
  name       TEXT NOT NULL,
  name_kana  TEXT,
  pref       TEXT,
  lat        REAL,
  lon        REAL,
  elevation  REAL,
  type       TEXT,
  obs_start  TEXT,
  -- 全期間を取りに行っても気温が1行も返らなかった地点（雨量のみ等）。
  -- 毎回154年ぶんを問い合わせるのは無駄なので記録して以後スキップする。
  temp_unavailable INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE daily_max (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id    INTEGER NOT NULL REFERENCES stations(id),
  date          TEXT NOT NULL,
  max_temp      REAL NOT NULL,
  max_temp_time TEXT,
  quality_flag  TEXT,
  UNIQUE (station_id, date)
);
"""
INDEXES = [
    "CREATE INDEX idx_daily_date ON daily_max(date)",
    "CREATE INDEX idx_daily_temp ON daily_max(max_temp DESC)",
    "CREATE INDEX idx_daily_station ON daily_max(station_id)",
]


def date_chunks(start: date, end: date, chunk_days: int):
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=chunk_days - 1), end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def _fresh_session() -> requests.Session:
    """obsdl は show/table を同一セッションで連続POSTするとエラーページを返す。
    リクエストごとに GET index からやり直した新しいセッションを使う。"""
    s = requests.Session()
    s.headers.update({"User-Agent": "maxtemp-ingest/0.1 (+Phase1 daily backfill; app support)"})
    s.get(obsdl.OBSDL_INDEX_URL, timeout=20)
    return s


def fetch_station_history(stid: str, end: date, start: date = HISTORY_START) -> list[dict]:
    rows: list[dict] = []
    for c_start, c_end in date_chunks(start, end, CHUNK_DAYS):
        try:
            csv_text = obsdl.fetch_csv(_fresh_session(), stid, c_start, c_end)
        except requests.RequestException as e:
            print(f"    [warn] {stid} {c_start}..{c_end} 失敗: {e}", file=sys.stderr)
            time.sleep(0.5)
            continue
        if csv_text.lstrip().startswith("<!DOCTYPE"):
            print(f"    [warn] {stid} {c_start}..{c_end} エラーページ応答", file=sys.stderr)
            time.sleep(0.5)
            continue
        parsed = obsdl.parse_daily_max_csv(csv_text, stid)
        rows.extend(r for r in parsed if r["max_temp"] is not None)
        time.sleep(0.4)  # ポライトネス
    return rows


OVERLAP_DAYS = 10   # 気象庁が後から値を訂正することがあるので直近は取り直す
JST = timezone(timedelta(hours=9))
TODAY_CUTOFF_HOUR = 15   # JSTでこの時刻以降なら「当日」も取りに行く


def resolve_end_date(mode: str = "auto") -> date:
    """obsdl（過去の気象データ）から取れる終端日 = 常に「前日」。

    obsdl は当日を含む期間を要求すると CSV ではなくHTMLエラーページを返す
    （実測: 7/18-7/22 は取得できるが 7/18-7/23 はエラー）。アーカイブなので
    確定した日しか持っていない。当日の速報値は fetch_realtime.py が
    気象庁の実況CSV（mdrr）から別途取得する。
    """
    return datetime.now(JST).date() - timedelta(days=1)


CELL_LIMIT = 40000       # obsdlの 44000 制限に対する安全マージン
MAX_BATCH_STATIONS = 80  # 1リクエストの応答サイズを抑えるための上限


def fetch_batch(stids: list[str], start: date, end: date) -> dict[str, list[dict]]:
    """複数地点を1リクエストでまとめ取りする（差分取込用）。

    地点ごとに1リクエスト投げると166地点で約250秒かかるうえ気象庁にも負荷が高い。
    差分は十数日ぶんなので、地点数×日数が制限に収まる範囲でまとめる。
    """
    days = (end - start).days + 1
    per_req = max(1, min(MAX_BATCH_STATIONS, CELL_LIMIT // max(days, 1)))
    out: dict[str, list[dict]] = {}
    for i in range(0, len(stids), per_req):
        chunk = stids[i:i + per_req]
        try:
            csv_text = obsdl.fetch_csv_multi(_fresh_session(), chunk, start, end)
        except requests.RequestException as e:
            print(f"    [warn] batch {i}: {e}", file=sys.stderr)
            continue
        if csv_text.lstrip().startswith("<!DOCTYPE"):
            print(f"    [warn] batch {i}: エラーページ応答", file=sys.stderr)
            continue
        out.update(obsdl.parse_daily_max_csv_multi(csv_text, chunk))
        time.sleep(0.5)
    return out


def open_db() -> sqlite3.Connection:
    """既存DBを開く。無ければスキーマを作る。"""
    fresh = not DB_PATH.exists()
    con = sqlite3.connect(DB_PATH)
    if fresh:
        con.executescript(SCHEMA)
        for idx in INDEXES:
            con.execute(idx)
        con.commit()
    else:
        cols = {r[1] for r in con.execute("PRAGMA table_info(stations)")}
        for name, ddl in (("temp_unavailable", "INTEGER NOT NULL DEFAULT 0"),
                          ("amedastable_code", "TEXT")):
            if name not in cols:   # 既存DB（HFから復元した版など）への追加
                con.execute(f"ALTER TABLE stations ADD COLUMN {name} {ddl}")
        con.commit()
    return con


def sync_stations(con: sqlite3.Connection, stations: list[dict]) -> dict[str, int]:
    """stations.json の内容をDBへ反映し、jma_code -> stations.id を返す。"""
    for s in stations:
        con.execute(
            "INSERT INTO stations (jma_code,amedastable_code,name,name_kana,pref,lat,lon,elevation,type)"
            " VALUES (?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(jma_code) DO UPDATE SET"
            "  amedastable_code=excluded.amedastable_code,"
            "  name=excluded.name, name_kana=excluded.name_kana, pref=excluded.pref,"
            "  lat=excluded.lat, lon=excluded.lon, elevation=excluded.elevation, type=excluded.type",
            (s["jma_code"], s.get("amedastable_code"), s["name"], s.get("name_kana"), s.get("pref"),
             s.get("lat"), s.get("lon"), s.get("elevation"), s.get("type")),
        )
    con.commit()
    return {r[1]: r[0] for r in con.execute("SELECT id,jma_code FROM stations")}


def refresh_obs_start(con: sqlite3.Connection) -> None:
    con.execute(
        "UPDATE stations SET obs_start = ("
        "  SELECT MIN(date) FROM daily_max d WHERE d.station_id = stations.id)")
    con.commit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=None, help="先頭N地点だけ取り込む（テスト用）")
    ap.add_argument("--full", action="store_true",
                    help="全期間を取り直してDBを作り直す（初回バックフィル用）")
    ap.add_argument("--until", choices=["auto", "today", "yesterday"], default="auto",
                    help="取込の終端日。auto=JST15時以降なら当日、それ以前は前日（既定）")
    args = ap.parse_args()

    stations = json.load(open(STATIONS_JSON, encoding="utf-8"))["stations"]
    if args.limit:
        stations = stations[: args.limit]
    end = resolve_end_date(args.until)
    now_jst = datetime.now(JST)
    print(f"[daily] 実行 {now_jst:%Y-%m-%d %H:%M} JST / 終端日 {end}"
          f"{'（当日＝速報値）' if end == now_jst.date() else ''}", file=sys.stderr)

    if args.full and DB_PATH.exists():
        DB_PATH.unlink()

    con = open_db()
    stid_to_id = sync_stations(con, stations)

    # 地点ごとの取込済み最終日（差分の起点になる）
    have: dict[int, str] = {
        r[0]: r[1] for r in con.execute("SELECT station_id, MAX(date) FROM daily_max GROUP BY station_id")
    }

    UPSERT = (
        "INSERT INTO daily_max (station_id,date,max_temp,max_temp_time,quality_flag)"
        " VALUES (?,?,?,?,?)"
        " ON CONFLICT(station_id,date) DO UPDATE SET"
        "  max_temp=excluded.max_temp, quality_flag=excluded.quality_flag"
    )

    # 起点日ごとに束ねる。既存地点はほぼ同じ起点になるので1〜2リクエストで済む。
    # 気温が取れないと判明済みの地点（雨量のみ等）は再挑戦しない
    no_temp = {r[0] for r in con.execute(
        "SELECT jma_code FROM stations WHERE temp_unavailable=1")}

    groups: dict[date, list[str]] = {}
    backfill: list[str] = []
    skipped = 0
    for s in stations:
        stid = s["jma_code"]
        if stid in no_temp:
            skipped += 1
            continue
        last = have.get(stid_to_id[stid])
        if not last:
            backfill.append(stid)          # 新規地点は全期間（重いので個別に取る）
            continue
        start = date.fromisoformat(last) - timedelta(days=OVERLAP_DAYS)
        if start > end:
            skipped += 1
            continue
        groups.setdefault(start, []).append(stid)

    added = 0
    for start, stids in sorted(groups.items()):
        days = (end - start).days + 1
        print(f"[daily] 差分 {start}〜{end} ({days}日) × {len(stids)}地点 をまとめ取得 …",
              file=sys.stderr, end="", flush=True)
        got = fetch_batch(stids, start, end)
        for stid, rows in got.items():
            con.executemany(UPSERT, [(stid_to_id[stid], r["date"], r["max_temp"],
                                      r["max_temp_time"], r["quality_flag"]) for r in rows])
            added += len(rows)
        con.commit()
        print(f" {sum(len(v) for v in got.values()):,}行", file=sys.stderr)

    for i, stid in enumerate(backfill):
        print(f"[daily] 新規地点 ({i+1}/{len(backfill)}) {stid} 全期間 …",
              file=sys.stderr, end="", flush=True)
        rows = fetch_station_history(stid, end, HISTORY_START)
        con.executemany(UPSERT, [(stid_to_id[stid], r["date"], r["max_temp"],
                                  r["max_temp_time"], r["quality_flag"]) for r in rows])
        if not rows:
            # 全期間問い合わせて0行 = 気温を観測していない地点。以後スキップする。
            con.execute("UPDATE stations SET temp_unavailable=1 WHERE jma_code=?", (stid,))
        con.commit()
        added += len(rows)
        print(f" {len(rows):,}行{'（気温なしと記録）' if not rows else ''}", file=sys.stderr)

    refresh_obs_start(con)
    con.execute("ANALYZE")
    con.commit()

    n_daily = con.execute("SELECT COUNT(*) FROM daily_max").fetchone()[0]
    n_st = con.execute("SELECT COUNT(*) FROM stations").fetchone()[0]
    latest = con.execute("SELECT MAX(date) FROM daily_max").fetchone()[0]
    con.close()
    print(f"\n[daily] 完了: 取得{added:,}行 / 最新日 {latest} / スキップ{skipped}地点\n"
          f"        DB: stations={n_st} daily_max={n_daily:,}行 "
          f"({DB_PATH.stat().st_size:,} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
