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
from datetime import date, timedelta
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


def fetch_station_history(stid: str, end: date) -> list[dict]:
    rows: list[dict] = []
    for c_start, c_end in date_chunks(HISTORY_START, end, CHUNK_DAYS):
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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="先頭N地点だけ取り込む（テスト用）")
    args = ap.parse_args()

    stations = json.load(open(STATIONS_JSON, encoding="utf-8"))["stations"]
    if args.limit:
        stations = stations[: args.limit]
    end = date.today() - timedelta(days=1)   # 当日は未確定なので昨日まで

    # 収集
    all_daily: dict[str, list[dict]] = {}
    for i, s in enumerate(stations):
        stid = s["jma_code"]
        print(f"[daily] ({i+1}/{len(stations)}) {stid} {s['pref']} {s['name']} …",
              file=sys.stderr, end="", flush=True)
        rows = fetch_station_history(stid, end)
        all_daily[stid] = rows
        span = f"{rows[0]['date']}〜{rows[-1]['date']}" if rows else "データなし"
        print(f" {len(rows):,}行 ({span})", file=sys.stderr)

    # SQLite 構築
    if DB_PATH.exists():
        DB_PATH.unlink()
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)

    stid_to_id: dict[str, int] = {}
    for s in stations:
        obs_start = min((r["date"] for r in all_daily.get(s["jma_code"], [])), default=None)
        cur = con.execute(
            "INSERT INTO stations (jma_code,name,name_kana,pref,lat,lon,elevation,type,obs_start)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (s["jma_code"], s["name"], s.get("name_kana"), s.get("pref"),
             s.get("lat"), s.get("lon"), s.get("elevation"), s.get("type"), obs_start),
        )
        stid_to_id[s["jma_code"]] = cur.lastrowid

    total = 0
    for stid, rows in all_daily.items():
        sid = stid_to_id[stid]
        con.executemany(
            "INSERT OR IGNORE INTO daily_max (station_id,date,max_temp,max_temp_time,quality_flag)"
            " VALUES (?,?,?,?,?)",
            [(sid, r["date"], r["max_temp"], r["max_temp_time"], r["quality_flag"]) for r in rows],
        )
        total += len(rows)

    for idx in INDEXES:
        con.execute(idx)
    con.execute("ANALYZE")
    con.commit()

    n_daily = con.execute("SELECT COUNT(*) FROM daily_max").fetchone()[0]
    n_st = con.execute("SELECT COUNT(*) FROM stations").fetchone()[0]
    con.close()
    print(f"\n[daily] SQLite 構築完了: {DB_PATH.relative_to(DATA_DIR.parent)} "
          f"({DB_PATH.stat().st_size:,} bytes) / stations={n_st} daily_max={n_daily:,}行",
          file=sys.stderr)


if __name__ == "__main__":
    main()
