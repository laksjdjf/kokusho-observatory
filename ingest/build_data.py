#!/usr/bin/env python3
"""build_data.py — 取込スクリプトを叩いて、フロントが読む配信用JSONを生成する。

Phase 0 の成果物:
  data/national_all_time.json  … 歴代全国ランキング（日最高気温）
  data/stations.json           … 観測地点マスタ（官署=type A のサブセット）
  data/meta.json               … 生成メタ情報（取得時刻・出典）

歴代ランキングは fetch_rankall.py、地点マスタは fetch_stations.py を再利用する。
実データを気象庁から取得するため、ネットワークが必要（FINDINGS.md 参照）。

使い方:
    uv run python build_data.py                 # ランキングのみ（軽量・GETのみ）
    uv run python build_data.py --with-stations # 地点マスタも全国クロールして生成
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import fetch_rankall
import fetch_stations
import requests

# data/ はリポジトリ直下（ingest/ の一つ上）
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

SOURCE_NOTE = "出典：気象庁ホームページ（https://www.data.jma.go.jp/stats/etrn/）を加工して作成"

JP_DATE_RE = re.compile(r"(\d{4})年(\d{1,2})月(\d{1,2})日")


def jp_date_to_iso(s: str) -> str | None:
    """'2025年8月5日' -> '2025-08-05'。パースできなければ None。"""
    m = JP_DATE_RE.search(s or "")
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}"


def tier_for(temp: float) -> int:
    """最高到達カテゴリ: 4=酷暑日(>=40) 3=猛暑日(>=35) 2=真夏日(>=30) 1=夏日(>=25) 0=それ未満。"""
    if temp >= 40:
        return 4
    if temp >= 35:
        return 3
    if temp >= 30:
        return 2
    if temp >= 25:
        return 1
    return 0


def build_national_ranking() -> list[dict]:
    html = fetch_rankall.fetch_rankall(month=None)
    rows = fetch_rankall.parse_rankall(html)
    out = []
    for r in rows:
        # rankall には「最高気温の高い方から」と「最高気温の低い方から」
        # （＝日最高気温が最も低かった記録。富士山 -32.0℃ 等）の両方がある。
        # ここでは"高い方"のみ採用する。
        if not (r["element"].startswith("最高気温") and "高い方" in r["element"]):
            continue
        try:
            temp = float(r["value"])
        except (TypeError, ValueError):
            continue
        out.append({
            "rank": int(r["rank"]) if str(r["rank"]).isdigit() else None,
            "temp": temp,
            "tier": tier_for(temp),
            "station": r["station"],
            "pref": r["pref"],
            "date": jp_date_to_iso(r["date"]),
            "date_label": r["date"],
            "relocated": bool(r["station_note"]),   # 末尾* = 移転・機器変更等のJMA脚注
            "still_observing": r["still_observing"],
        })
    return out


def build_stations_master(pref_ids=None, include_names: set[str] | None = None) -> list[dict]:
    include_names = include_names or set()
    session = requests.Session()
    session.headers.update({"User-Agent": "maxtemp-ingest/0.1 (+feasibility; app support)"})
    amedastable = fetch_stations.fetch_amedastable(session)
    obsdl_rows = fetch_stations.fetch_obsdl_stations(session, pref_ids=pref_ids, polite_delay=0.4)
    master = fetch_stations.build_station_master(amedastable, obsdl_rows)
    out = []
    skipped = []
    for s in master:
        # 官署(type A) ＋ 4要素アメダス(type B) ＋ 歴代ランキング掲載地点。
        # 記録保持アメダス(多治見・江川崎・伊勢崎等)は amedastable 上 type=C 扱い
        # だが実際は気温観測あり(FINDINGSの罠)。ランキング掲載名は type 無視で採用。
        # obsdl と名前JOINできた（=stid と県が取れた）ものだけ。
        in_ranking = s.name in include_names
        if (s.type not in ("A", "B") and not in_ranking) or s.lat is None or s.lon is None:
            continue
        if s.jma_code.startswith("amd:") or not s.pref:
            skipped.append(s.name)
            continue
        out.append({
            "jma_code": s.jma_code,
            "name": s.name,
            "name_kana": s.name_kana,
            "pref": s.pref,
            "lat": s.lat,
            "lon": s.lon,
            "elevation": s.elevation,
            "type": s.type,
        })
    if skipped:
        print(f"[stations] 同名衝突で除外した官署 {len(skipped)}件（要QA）: "
              f"{'、'.join(skipped)}", file=sys.stderr)
    out.sort(key=lambda x: x["jma_code"])
    return out


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  wrote {path.relative_to(DATA_DIR.parent)}  "
          f"({path.stat().st_size:,} bytes)", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--with-stations", action="store_true",
                    help="地点マスタ（官署）も全国クロールして生成する")
    ap.add_argument("--pref-ids", type=int, nargs="*", default=None,
                    help="地点クロールを指定都道府県idに限定（テスト用）")
    args = ap.parse_args()

    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    print("[build] 歴代全国ランキング（日最高気温）...", file=sys.stderr)
    ranking = build_national_ranking()
    write_json(DATA_DIR / "national_all_time.json", {
        "meta": {"fetched_at": fetched_at, "source": SOURCE_NOTE,
                 "element": "日最高気温", "count": len(ranking)},
        "records": ranking,
    })
    top = ranking[0] if ranking else None
    if top:
        print(f"[build] 現在の歴代1位: {top['temp']}℃ {top['pref']}{top['station']} "
              f"({top['date']})", file=sys.stderr)

    if args.with_stations:
        print("[build] 地点マスタ（官署A＋アメダスB＋ランキング掲載地点）...", file=sys.stderr)
        include_names = {r["station"] for r in ranking}
        stations = build_stations_master(pref_ids=args.pref_ids, include_names=include_names)
        write_json(DATA_DIR / "stations.json", {
            "meta": {"fetched_at": fetched_at, "source": SOURCE_NOTE,
                     "subset": "官署(A)＋4要素アメダス(B)＋歴代ランキング掲載地点", "count": len(stations)},
            "stations": stations,
        })

    write_json(DATA_DIR / "meta.json", {
        "generated_at": fetched_at,
        "source": SOURCE_NOTE,
        "license": "気象庁 公共データ利用規約（第1.0版）— 出典明記のうえ自由利用可",
    })
    print("[build] 完了", file=sys.stderr)


if __name__ == "__main__":
    main()
