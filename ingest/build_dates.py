#!/usr/bin/env python3
"""build_dates.py — 日付ごとの詳細ランキング用JSONを生成する（Phase 2）。

全日付(約56,000日)は多すぎるので、「全国最高が猛暑日(≥35℃)に達した日」＝
マニア的に意味のある"暑い日" 約4,300日 ＋ 直近120日 に絞る。

生成物:
  data/date/<YYYY-MM-DD>.json   その日の全国ランキング（官署）＋サマリー
  data/dates_index.json         対象日の一覧（全国最高・猛暑日/酷暑日地点数）
                                = 「歴代 暑かった日ランキング」の素材
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "max_temp.sqlite"
SOURCE = "出典：気象庁ホームページ（過去の気象データ）を加工して作成"
HOT_THRESHOLD = 35.0
RECENT_DAYS = 120


def tier_for(t: float) -> int:
    return 4 if t >= 40 else 3 if t >= 35 else 2 if t >= 30 else 1 if t >= 25 else 0


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(payload, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    latest = con.execute("SELECT MAX(date) d FROM daily_max").fetchone()["d"]
    recent_from = (date.fromisoformat(latest) - timedelta(days=RECENT_DAYS)).isoformat()

    # 対象日: 全国最高>=35 の日 ∪ 直近120日
    target = {r["date"] for r in con.execute(
        "SELECT date FROM daily_max GROUP BY date HAVING MAX(max_temp)>=?", (HOT_THRESHOLD,)
    )}
    target |= {r["date"] for r in con.execute(
        "SELECT DISTINCT date FROM daily_max WHERE date>=?", (recent_from,)
    )}
    dates = sorted(target)
    print(f"[dates] 対象 {len(dates):,}日 (猛暑日ベース + 直近{RECENT_DAYS}日)", file=sys.stderr)

    index = []
    for d in dates:
        rows = con.execute(
            "SELECT s.jma_code,s.name,s.pref,x.max_temp FROM daily_max x "
            "JOIN stations s ON s.id=x.station_id WHERE x.date=? ORDER BY x.max_temp DESC",
            (d,),
        ).fetchall()
        if not rows:
            continue
        records = [
            {"rank": i + 1, "jma_code": r["jma_code"], "station": r["name"],
             "pref": r["pref"], "temp": r["max_temp"], "tier": tier_for(r["max_temp"])}
            for i, r in enumerate(rows)
        ]
        nat_max = rows[0]["max_temp"]
        mousho = sum(1 for r in rows if r["max_temp"] >= 35)
        kokusho = sum(1 for r in rows if r["max_temp"] >= 40)
        write_json(DATA_DIR / "date" / f"{d}.json", {
            "meta": {"date": d, "source": SOURCE, "count": len(records),
                     "national_max": nat_max, "mousho_count": mousho, "kokusho_count": kokusho},
            "records": records,
        })
        index.append({"date": d, "max": nat_max, "tier": tier_for(nat_max),
                      "mousho": mousho, "kokusho": kokusho,
                      "top_station": rows[0]["name"], "top_pref": rows[0]["pref"]})

    # 索引は日付降順（新しい順）で保存。クライアントで暑さ順に並べ替え可能。
    index.sort(key=lambda x: x["date"], reverse=True)
    write_json(DATA_DIR / "dates_index.json", {
        "meta": {"source": SOURCE, "count": len(index), "latest": latest,
                 "note": f"全国最高が{int(HOT_THRESHOLD)}℃以上の日 ＋ 直近{RECENT_DAYS}日（官署のみ）"},
        "dates": index,
    })
    print(f"[dates] date/ に {len(index):,}ファイル ＋ dates_index.json 生成", file=sys.stderr)
    con.close()


if __name__ == "__main__":
    main()
