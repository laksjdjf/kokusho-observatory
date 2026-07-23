#!/usr/bin/env python3
"""build_stations_all.py — 気温を観測する全地点（約914）の地点マスタを作る。

「どの地点が気温を観測しているか」の権威リストは、気象庁の実況極値CSV
（当日の最高気温を出している地点＝気温観測がある地点）である。
amedastable の type は当てにならない（type=C の多治見や伊勢崎が実際は
記録保持地点、というのを実測で確認済み。FINDINGS.md 参照）。

  実況CSV  … 観測所番号(=amedastableのコード)・都道府県・地点名
  amedastable … 緯度経度・標高・かな・種別
  obsdl    … 過去データ取得に必須の stid

obsdl だけ共通キーが無いので (都道府県, 地点名) で突合する。地点名だけだと
全国で同名衝突が多いが、県まで一致させればほぼ一意になる。

    uv run python build_stations_all.py
"""
from __future__ import annotations

import io
import json
import re
import sys

import pandas as pd
import requests

import fetch_stations as fs
from build_data import DATA_DIR, SOURCE_NOTE, write_json
from fetch_realtime import RCT_URL


def norm_pref(p: str) -> str:
    """『岐阜県』→『岐阜』。北海道はそのまま。"""
    p = (p or "").strip()
    # 実況CSVは「北海道宗谷地方」のように振興局まで含むが、こちらは北海道で統一済み
    if p.startswith("北海道"):
        return "北海道"
    # 「京都」は末尾が『都』なので単純に落とすと『京』になってしまう。
    # 『京都府』(3字)→『京都』、『京都』(2字)→そのまま、となるよう長さで判定する。
    return re.sub(r"[都道府県]$", "", p) if len(p) >= 3 else p


def norm_name(n: str) -> str:
    """『多治見（タジミ）』→『多治見』"""
    # 「つくば(館野)」のような半角カッコの別名表記もある
    n = re.sub(r"[（(][^）)]*[）)]", "", (n or ""))
    return re.sub(r"[（()）]", "", n).strip()   # 対応の取れない括弧が残る表記もある


def main() -> None:
    session = requests.Session()
    session.headers.update({"User-Agent": "maxtemp-ingest/0.1 (+full station master)"})

    print("[all] 実況CSVから気温観測地点を取得…", file=sys.stderr)
    r = session.get(RCT_URL, timeout=30)
    r.raise_for_status()
    rct = pd.read_csv(io.BytesIO(r.content), encoding="cp932")
    c = list(rct.columns)
    wanted = {}
    for _, row in rct.iterrows():
        code = str(row[c[0]]).strip()
        wanted[code] = (norm_pref(str(row[c[1]])), norm_name(str(row[c[2]])))
    print(f"[all] 気温観測地点 {len(wanted)}件", file=sys.stderr)

    amedas = fs.fetch_amedastable(session)
    obsdl_rows = fs.fetch_obsdl_stations(session, polite_delay=0.35)

    # 61都道府県を1セッションで連続POSTすると一部が空応答を返すことがある。
    # 0件は例外にならず警告も出ないため黙って県ごと欠落する（実際に京都府が
    # まるごと消えた）。空だった県はセッションを作り直して取り直す。
    for attempt in range(3):
        got = {r["prid"] for r in obsdl_rows}
        missing = [p for p in fs.PREF_IDS if p not in got]
        if not missing:
            break
        print(f"[all] 空応答だった地方 {len(missing)}件を再取得（{attempt + 1}回目）: {missing}",
              file=sys.stderr)
        for prid in missing:
            s2 = requests.Session()
            s2.headers.update({"User-Agent": "maxtemp-ingest/0.1 (+retry)"})
            obsdl_rows += fs.fetch_obsdl_stations(s2, pref_ids=[prid], polite_delay=0.4)

    # (県, 地点名) -> stid。重複キーは衝突として記録し採用しない。
    by_key: dict[tuple[str, str], list[dict]] = {}
    for row in obsdl_rows:
        by_key.setdefault((norm_pref(row["pref_name"]), row["stname"]), []).append(row)

    out, unmatched, ambiguous = [], [], []
    for code, (pref, name) in wanted.items():
        rec = amedas.get(code)
        if not rec:
            unmatched.append(f"{pref}{name}(amedastable無し)")
            continue
        cands = by_key.get((pref, name), [])
        if len(cands) != 1:
            (ambiguous if cands else unmatched).append(f"{pref}{name}")
            continue
        row = cands[0]
        out.append({
            "jma_code": row["stid"],
            "amedastable_code": code,
            "name": name,
            "name_kana": rec.get("knName"),
            "pref": pref,
            "lat": fs.dms_to_decimal(rec.get("lat")),
            "lon": fs.dms_to_decimal(rec.get("lon")),
            "elevation": rec.get("alt"),
            "type": rec.get("type"),
        })

    out.sort(key=lambda x: x["jma_code"])
    write_json(DATA_DIR / "stations.json", {
        "meta": {"source": SOURCE_NOTE, "count": len(out),
                 "subset": "気温を観測する全地点（実況極値CSV基準）"},
        "stations": out,
    })
    print(f"[all] 採用 {len(out)}地点 / 同名衝突 {len(ambiguous)}件 / 突合不可 {len(unmatched)}件",
          file=sys.stderr)
    if ambiguous:
        print(f"[all] 衝突: {'、'.join(ambiguous[:15])}{'…' if len(ambiguous) > 15 else ''}",
              file=sys.stderr)
    if unmatched:
        print(f"[all] 不可: {'、'.join(unmatched[:15])}{'…' if len(unmatched) > 15 else ''}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
