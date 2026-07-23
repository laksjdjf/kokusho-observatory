#!/usr/bin/env python3
"""build_views.py — data/max_temp.sqlite から、フロント配信用の事前計算JSONを生成する。

生成物:
  data/daily_latest.json          最新観測日（≒昨日）の全国ランキング
  data/niche_mousho.json          地点別 歴代 猛暑日/酷暑日 回数・最長連続猛暑日
  data/stations_summary.json      地点一覧＋観測期間＋自己ベスト＋各種日数
  data/station/<jma_code>.json     地点ごと（自己ベストTOP・年別サマリー・統計）

歴代ランキング(national_all_time.json)は build_data.py が別途生成する。
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "max_temp.sqlite"
SOURCE = "出典：気象庁ホームページ（過去の気象データ）を加工して作成"


def tier_for(t: float) -> int:
    return 4 if t >= 40 else 3 if t >= 35 else 2 if t >= 30 else 1 if t >= 25 else 0


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    json.dump(payload, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def longest_mousho_streak(dates_ge35: list[str]) -> int:
    """猛暑日(>=35)の日付ISO昇順リストから最長連続日数を返す。"""
    from datetime import date
    best = cur = 0
    prev = None
    for d in dates_ge35:
        cd = date.fromisoformat(d)
        if prev is not None and (cd - prev).days == 1:
            cur += 1
        else:
            cur = 1
        best = max(best, cur)
        prev = cd
    return best


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    stations = con.execute(
        "SELECT id,jma_code,name,name_kana,pref,lat,lon,elevation,obs_start FROM stations"
    ).fetchall()

    # ---- 最新日の全国ランキング ----
    latest = con.execute("SELECT MAX(date) d FROM daily_max").fetchone()["d"]
    rows = con.execute(
        "SELECT s.jma_code,s.name,s.pref,d.max_temp FROM daily_max d "
        "JOIN stations s ON s.id=d.station_id WHERE d.date=? ORDER BY d.max_temp DESC",
        (latest,),
    ).fetchall()
    # 当日ぶんは日中の途中経過なので速報値扱い（翌朝の実行で訂正され得る）
    from datetime import datetime, timedelta, timezone
    today_jst = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    write_json(DATA_DIR / "daily_latest.json", {
        "meta": {"date": latest, "source": SOURCE, "count": len(rows),
                 "provisional": latest == today_jst,
                 "note": "気象官署＋アメダス"},
        "records": [
            {"rank": i + 1, "jma_code": r["jma_code"], "station": r["name"],
             "pref": r["pref"], "temp": r["max_temp"], "tier": tier_for(r["max_temp"])}
            for i, r in enumerate(rows)
        ],
    })
    print(f"[views] daily_latest: {latest} {len(rows)}地点", file=sys.stderr)

    # ---- 地点ごとの集計＋ページ ----
    summary = []
    for s in stations:
        drows = con.execute(
            "SELECT date,max_temp FROM daily_max WHERE station_id=? ORDER BY max_temp DESC",
            (s["id"],),
        ).fetchall()
        if not drows:
            continue
        temps = [r["max_temp"] for r in drows]
        n = len(temps)
        natsu = sum(1 for t in temps if t >= 25)
        manatsu = sum(1 for t in temps if t >= 30)
        mousho = sum(1 for t in temps if t >= 35)
        kokusho = sum(1 for t in temps if t >= 40)
        best = drows[0]

        # 年別サマリー
        yearly = con.execute(
            "SELECT substr(date,1,4) y, MAX(max_temp) mx, "
            "SUM(max_temp>=35) mousho, SUM(max_temp>=40) kokusho "
            "FROM daily_max WHERE station_id=? GROUP BY y ORDER BY y", (s["id"],),
        ).fetchall()

        ge35_dates = sorted(r["date"] for r in
                            con.execute("SELECT date FROM daily_max WHERE station_id=? AND max_temp>=35",
                                        (s["id"],)).fetchall())
        streak = longest_mousho_streak(ge35_dates)

        stats = {
            "days": n, "natsu": natsu, "manatsu": manatsu, "mousho": mousho,
            "kokusho": kokusho, "record_high": best["max_temp"],
            "record_high_date": best["date"], "longest_mousho_streak": streak,
        }
        station_obj = {k: s[k] for k in ("jma_code", "name", "name_kana", "pref",
                                         "lat", "lon", "elevation", "obs_start")}
        write_json(DATA_DIR / "station" / f"{s['jma_code']}.json", {
            "meta": {"source": SOURCE},
            "station": station_obj,
            "stats": stats,
            "best": [
                {"date": r["date"], "temp": r["max_temp"], "tier": tier_for(r["max_temp"])}
                for r in drows[:30]
            ],
            "yearly": [
                {"year": int(r["y"]), "max": r["mx"], "mousho": r["mousho"], "kokusho": r["kokusho"]}
                for r in yearly
            ],
        })
        summary.append({**station_obj, **{"stats": stats}})

    summary.sort(key=lambda x: x["stats"]["record_high"], reverse=True)
    write_json(DATA_DIR / "stations_summary.json", {
        "meta": {"source": SOURCE, "count": len(summary),
                 "subset": "気象官署＋アメダス（4要素・歴代ランキング掲載地点を含む）"},
        "stations": summary,
    })
    print(f"[views] station pages: {len(summary)}件", file=sys.stderr)

    # ---- ニッチ集計：地点別 歴代猛暑日回数ランキング ----
    niche = sorted(
        ({"jma_code": x["jma_code"], "station": x["name"], "pref": x["pref"],
          "mousho": x["stats"]["mousho"], "kokusho": x["stats"]["kokusho"],
          "longest_streak": x["stats"]["longest_mousho_streak"],
          "record_high": x["stats"]["record_high"]}
         for x in summary),
        key=lambda r: r["mousho"], reverse=True,
    )
    for i, r in enumerate(niche):
        r["rank"] = i + 1
    write_json(DATA_DIR / "niche_mousho.json", {
        "meta": {"source": SOURCE, "count": len(niche),
                 "note": "地点別 歴代 猛暑日(≥35℃)日数ランキング（官署のみ）"},
        "records": niche,
    })
    print(f"[views] niche_mousho: {len(niche)}件", file=sys.stderr)
    con.close()


if __name__ == "__main__":
    main()
