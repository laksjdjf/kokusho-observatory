#!/usr/bin/env python3
"""fetch_realtime.py — 当日の最高気温（速報値）を気象庁の実況CSVから取得する。

なぜ別ソースが必要か:
  過去データDL(obsdl)はアーカイブなので当日を持たない。当日を含む期間を
  要求するとCSVではなくHTMLエラーページが返る（実測で確認）。
  そこで当日ぶんだけ、気象庁が10分間隔で更新している実況の極値CSVを使う。

ソース:
  https://www.data.jma.go.jp/stats/data/mdrr/tem_rct/alltable/mxtemsadext00_rct.csv
  全国914地点の「当日の最高気温」＋起時（何時何分に記録したか）。1リクエストで全地点。
  ※ obsdlに無い max_temp_time がここでは取れるので併せて格納する。

突合:
  CSVの「観測所番号」は amedastable のコードと一致する（実測 914/914）。
  stations.json の amedastable_code と突き合わせて、追跡中の地点にだけ入れる。

値は速報値であり、翌日以降 obsdl 側の確定値で上書きされる（build_daily の
OVERLAP_DAYS による再取得で自動的に訂正される）。

    uv run python fetch_realtime.py
"""
from __future__ import annotations

import io
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd
import requests

from build_daily import DB_PATH, STATIONS_JSON, JST, open_db

RCT_URL = ("https://www.data.jma.go.jp/stats/data/mdrr/tem_rct/alltable/"
           "mxtemsadext00_rct.csv")


def fetch_rct() -> pd.DataFrame:
    r = requests.get(RCT_URL, timeout=30,
                     headers={"User-Agent": "maxtemp-ingest/0.1 (+realtime daily max)"})
    r.raise_for_status()
    return pd.read_csv(io.BytesIO(r.content), encoding="cp932")


CUTOFF_HOUR = 14   # 当日の最高気温はおおむね昼過ぎに出揃う


def main() -> None:
    now = datetime.now(JST)
    force = "--force" in sys.argv
    # 当日の最高気温は午後に出る。朝に取り込むと「早朝の気温＝低い値」が
    # その日の最高として表示され、確定した前日より低い値がトップに来てしまう
    # （実際に朝6時の実行で神戸31.5℃等が本日最高になっていた）。
    # 14時より前は当日を触らず、前日の確定値をそのまま最新にしておく。
    if now.hour < CUTOFF_HOUR and not force:
        print(f"[rct] {now:%H:%M} JST — {CUTOFF_HOUR}時前なので当日速報は取得しない"
              f"（前日の確定値を最新のままにする）", file=sys.stderr)
        return
    df = fetch_rct()
    c = list(df.columns)
    # 列は固定順: 0=観測所番号 … 6=現在時刻(日) 9=最高気温 11=起時(時) 12=起時(分)
    obs_day = int(df[c[6]].iloc[0])
    temp_col, hh_col, mm_col = c[9], c[11], c[12]

    # CSVの「現在時刻(日)」を実日付に直す。now と日がズレていても、
    # 「日が一致する直近の過去日」まで1日ずつ遡るだけにする。
    # 以前は『日が違えば前月』と決めつけていたため、07-24の朝に CSV がまだ
    # 23日を指していると 06-23（前月）に書き込んでしまっていた。
    d = now.date()
    for _ in range(40):
        if d.day == obs_day:
            break
        d -= timedelta(days=1)
    else:
        sys.exit(f"[rct] 現在時刻(日)={obs_day} に一致する直近日が見つからない")
    date_iso = d.isoformat()

    stations = json.load(open(STATIONS_JSON, encoding="utf-8"))["stations"]
    by_amd = {str(s["amedastable_code"]): s["jma_code"]
              for s in stations if s.get("amedastable_code")}
    # 突合キーが失われていると「エラーは出ないが何も入らない」状態になり、
    # 気づかないまま当日データが止まる。ここで明示的に落とす。
    if len(by_amd) < len(stations) * 0.5:
        sys.exit(f"[rct] 中断: amedastable_code を持つ地点が {len(by_amd)}/{len(stations)} しかない。"
                 " `uv run python build_data.py --with-stations` で地点マスタを取り直してください。")

    con = open_db()
    stid_to_id = {r[1]: r[0] for r in con.execute("SELECT id,jma_code FROM stations")}

    rows, unmatched = [], 0
    for _, r in df.iterrows():
        stid = by_amd.get(str(r[c[0]]))
        if not stid or stid not in stid_to_id:
            unmatched += 1
            continue
        try:
            temp = round(float(r[temp_col]), 1)
        except (TypeError, ValueError):
            continue
        if pd.isna(temp):
            continue
        t = None
        try:
            t = f"{int(r[hh_col]):02d}:{int(r[mm_col]):02d}"
        except (TypeError, ValueError):
            pass
        rows.append((stid_to_id[stid], date_iso, temp, t, "rct"))

    con.executemany(
        "INSERT INTO daily_max (station_id,date,max_temp,max_temp_time,quality_flag)"
        " VALUES (?,?,?,?,?)"
        " ON CONFLICT(station_id,date) DO UPDATE SET"
        "  max_temp=excluded.max_temp, max_temp_time=excluded.max_temp_time,"
        "  quality_flag=excluded.quality_flag",
        rows)
    con.commit()
    top = con.execute(
        "SELECT s.pref,s.name,d.max_temp,d.max_temp_time FROM daily_max d "
        "JOIN stations s ON s.id=d.station_id WHERE d.date=? "
        "ORDER BY d.max_temp DESC LIMIT 3", (date_iso,)).fetchall()
    con.close()

    print(f"[rct] {date_iso} の速報値 {len(rows)}地点を反映"
          f"（CSV全{len(df)}地点中・追跡外{unmatched}地点は無視）", file=sys.stderr)
    for pref, name, t, tm in top:
        print(f"  {t}℃ {pref}{name} ({tm})", file=sys.stderr)


if __name__ == "__main__":
    main()
