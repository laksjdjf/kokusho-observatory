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
  name       TEXT NOT NULL,
  name_kana  TEXT,
  pref       TEXT,
  lat        REAL,
  lon        REAL,
  elevation  REAL,
  type       TEXT,
  obs_start  TEXT
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


def resolve_end_date(mode: str) -> date:
    """取込の終端日を決める。

    当日の最高気温は日中の経過とともに確定していくので、実行時刻で振る舞いを変える:
      - 15時(JST)以降 … 当日まで取る（ほぼ確定。夕方の速報用）
      - それ以前      … 前日まで（朝6時に当日を取ると「朝までの最高＝低い値」が入る）
    翌朝の実行で OVERLAP_DAYS ぶん取り直すため、暫定値は自動的に訂正される。
    """
    now = datetime.now(JST)
    if mode == "today":
        return now.date()
    if mode == "yesterday":
        return now.date() - timedelta(days=1)
    return now.date() if now.hour >= TODAY_CUTOFF_HOUR else now.date() - timedelta(days=1)


def open_db() -> sqlite3.Connection:
    """既存DBを開く。無ければスキーマを作る。"""
    fresh = not DB_PATH.exists()
    con = sqlite3.connect(DB_PATH)
    if fresh:
        con.executescript(SCHEMA)
        for idx in INDEXES:
            con.execute(idx)
        con.commit()
    return con


def sync_stations(con: sqlite3.Connection, stations: list[dict]) -> dict[str, int]:
    """stations.json の内容をDBへ反映し、jma_code -> stations.id を返す。"""
    for s in stations:
        con.execute(
            "INSERT INTO stations (jma_code,name,name_kana,pref,lat,lon,elevation,type)"
            " VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT(jma_code) DO UPDATE SET"
            "  name=excluded.name, name_kana=excluded.name_kana, pref=excluded.pref,"
            "  lat=excluded.lat, lon=excluded.lon, elevation=excluded.elevation, type=excluded.type",
            (s["jma_code"], s["name"], s.get("name_kana"), s.get("pref"),
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

    added = skipped = 0
    for i, s in enumerate(stations):
        stid = s["jma_code"]
        sid = stid_to_id[stid]
        last = have.get(sid)
        if last:
            # 既存分あり → 最終日の少し手前から取り直す（訂正値の取り込み）
            start = date.fromisoformat(last) - timedelta(days=OVERLAP_DAYS)
        else:
            start = HISTORY_START
        if start > end:
            skipped += 1
            continue

        label = "全期間" if not last else f"{start}〜"
        print(f"[daily] ({i+1}/{len(stations)}) {stid} {s['pref']} {s['name']} {label} …",
              file=sys.stderr, end="", flush=True)
        rows = fetch_station_history(stid, end, start)
        # 訂正値を反映するため REPLACE（UNIQUE(station_id,date) 前提）
        con.executemany(
            "INSERT INTO daily_max (station_id,date,max_temp,max_temp_time,quality_flag)"
            " VALUES (?,?,?,?,?)"
            " ON CONFLICT(station_id,date) DO UPDATE SET"
            "  max_temp=excluded.max_temp, quality_flag=excluded.quality_flag",
            [(sid, r["date"], r["max_temp"], r["max_temp_time"], r["quality_flag"]) for r in rows],
        )
        con.commit()
        added += len(rows)
        print(f" {len(rows):,}行", file=sys.stderr)

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
