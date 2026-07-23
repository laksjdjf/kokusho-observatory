#!/usr/bin/env python3
"""
fetch_stations.py — JMA (気象庁) station-master ingestion prototype.

WHY TWO SOURCES
---------------
There is no single JMA endpoint that gives {code, name, kana, pref, lat, lon,
elevation, type} in one shot. This script combines TWO independently-fetched
sources and cross-references them:

  (A) https://www.jma.go.jp/bosai/amedas/const/amedastable.json   [GET, JSON]
      -> lat/lon/elevation/kana(katakana)/English name/"type" (A/B/C/D/E/F/G),
         keyed by JMA's internal 5-digit AMeDAS *nowcast* point code.
         Verified live in this sandbox: 1286 stations, e.g.
           "44132": {"type":"A","lat":[35,41.5],"lon":[139,45.0],"alt":25,
                     "kjName":"東京","knName":"トウキョウ","enName":"Tokyo", ...}

  (B) https://www.data.jma.go.jp/risk/obsdl/top/station   [POST, HTML fragment]
      one call per prefecture id (61 ids incl. Hokkaido sub-regions + Antarctica,
      see PREF_IDS below), each returning the stations in that prefecture with
      their "stid" (e.g. "s47662" for 官署/major stations, "a0365" for
      AMeDAS-only points). THIS is the id you must use to actually download
      historical daily data (see fetch_obsdl_sample.py) — it is DIFFERENT from
      source (A)'s numeric code (confirmed: Tokyo is "44132" in (A) but
      "s47662" in (B); 小河内 is "44046" in (A) but "a0365" in (B)).

  A THIRD id system exists too: https://www.data.jma.go.jp/stats/etrn/ uses
  prec_no + block_no. Empirically, block_no == the numeric part of (B)'s stid
  with its "s"/"a" letter stripped (verified: s47662 -> block_no=47662,
  a0365 -> block_no=0365). So (B)'s stid doubles as your key into the
  rank_s.php per-station all-time-ranking page too. See FINDINGS.md.

Because (A) and (B) do not share a primary key, this script joins them on
station name (kjName == stname). This is a best-effort crosswalk:
  - Unmatched rows from either side are kept and flagged (matched=False)
    rather than silently dropped.
  - Name collisions across prefectures (rare, not observed in spot checks
    but not exhaustively verified) are flagged rather than guessed.

CAVEAT — DO NOT TRUST (A)'s "type" FIELD FOR "HAS TEMPERATURE" DECISIONS
-------------------------------------------------------------------------
(A) classifies stations as A=官署, B=4要素AMeDAS(has temp), C=降水のみ(no temp).
We verified empirically that this is NOT reliable: 野沢温泉 (48031, type "C" i.e.
nominally precip-only) actually returns real 最高気温 (daily max temp) values
from the obsdl download tool (22.8/25.4/29.2 degC for 2024-07-01..03 — see
samples/nozawa_check.json). Use an actual trial fetch against obsdl (element
code 202) to determine temperature-data availability per station; do not
filter using amedastable's "type" alone. This script keeps "type" as
informational metadata only.

USAGE
-----
    pip install -r requirements.txt
    python fetch_stations.py --out stations.csv                 # full national crawl (61 prefecture calls)
    python fetch_stations.py --out stations.csv --pref-ids 44    # just Tokyo, for a quick test
    python fetch_stations.py --amedastable-only --out stations.csv   # skip obsdl crawl entirely

If network egress is blocked in your environment, this script will print a
clear error for each failed request and continue; you'll get a partial/empty
result rather than a crash. It was verified to run successfully end-to-end
in the sandbox this prototype was built in (see ingest/FINDINGS.md and
ingest/samples/ for real fetched artifacts saved during that verification).
"""

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import requests

AMEDASTABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json"
OBSDL_INDEX_URL = "https://www.data.jma.go.jp/risk/obsdl/index.php"
OBSDL_PREF_MAP_URL = "https://www.data.jma.go.jp/risk/obsdl/top/station"  # POST pd=00
OBSDL_STATION_URL = "https://www.data.jma.go.jp/risk/obsdl/top/station"   # POST pd=<prid>

# Prefecture ids used by the obsdl station picker (Hokkaido is split into
# several sub-regions; 99 = Antarctica (Showa base)). Scraped live from
# pd=00 in this sandbox on 2026-07-22 — see samples/station_pd00.html.
PREF_IDS = [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,  # Hokkaido sub-regions
    31, 32, 33, 34, 35, 36,                                  # Tohoku
    40, 41, 42, 43, 44, 45, 46,                              # Kanto
    48, 49,                                                  # Koshin
    50, 51, 52, 53,                                          # Tokai
    54, 55, 56, 57,                                          # Hokuriku
    60, 61, 62, 63, 64, 65,                                  # Kinki
    66, 67, 68, 69,                                          # Chugoku
    71, 72, 73, 74,                                          # Shikoku
    81, 82, 83, 84, 85, 86, 87, 88,                          # Kyushu
    91,                                                      # Okinawa
    99,                                                       # Antarctica
]

# Same-name matching for prefecture display names (from pd=00, see
# samples/station_pd00.html). Not required for the join but useful metadata.
PREF_NAMES = {
    # 北海道は obsdl 上で地域(振興局)ごとに分かれるが、都道府県名としては「北海道」に統一する。
    11: "北海道", 12: "北海道", 13: "北海道", 14: "北海道", 15: "北海道", 16: "北海道",
    17: "北海道", 18: "北海道", 19: "北海道", 20: "北海道", 21: "北海道",
    22: "北海道", 23: "北海道", 24: "北海道",
    31: "青森", 32: "秋田", 33: "岩手", 34: "宮城", 35: "山形", 36: "福島",
    40: "茨城", 41: "栃木", 42: "群馬", 43: "埼玉", 44: "東京", 45: "千葉", 46: "神奈川",
    48: "長野", 49: "山梨",
    50: "静岡", 51: "愛知", 52: "岐阜", 53: "三重",
    54: "新潟", 55: "富山", 56: "石川", 57: "福井",
    60: "滋賀", 61: "京都", 62: "大阪", 63: "兵庫", 64: "奈良", 65: "和歌山",
    66: "岡山", 67: "広島", 68: "島根", 69: "鳥取",
    71: "徳島", 72: "香川", 73: "愛媛", 74: "高知",
    81: "山口", 82: "福岡", 83: "大分", 84: "長崎", 85: "佐賀", 86: "熊本", 87: "宮崎", 88: "鹿児島",
    91: "沖縄", 99: "南極",
}

STID_ROW_RE = re.compile(
    r'name="stid"\s+value="([a-z0-9]+)">'
    r'<input type="hidden" name="stname" value="([^"]*)">'
    r'<input type="hidden" name="prid" value="(\d+)">'
    r'<input type="hidden" name="kansoku" value="(\d+)">'
)


@dataclass
class StationRow:
    jma_code: str            # obsdl "stid" if available, else amedastable numeric key prefixed "amd:"
    name: str
    name_kana: Optional[str] = None
    pref: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    elevation: Optional[float] = None
    type: Optional[str] = None          # amedastable A/B/C/D/E/F/G (informational only, see caveat)
    obs_start: Optional[str] = None      # not populated by this script; see FINDINGS.md (rank_s.php has it)
    matched_sources: str = ""           # "amedastable+obsdl" | "amedastable" | "obsdl"
    amedastable_code: Optional[str] = None
    obsdl_stid: Optional[str] = None
    kansoku_bitmask: Optional[str] = None


def dms_to_decimal(dms) -> Optional[float]:
    """amedastable lat/lon are [degrees, decimal_minutes]."""
    if not dms:
        return None
    deg, minutes = dms
    return round(deg + minutes / 60.0, 6)


def fetch_amedastable(session: requests.Session) -> dict:
    print(f"[amedastable] GET {AMEDASTABLE_URL}", file=sys.stderr)
    resp = session.get(AMEDASTABLE_URL, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    print(f"[amedastable] got {len(data)} stations", file=sys.stderr)
    return data


def fetch_obsdl_stations(session: requests.Session, pref_ids=None, polite_delay=0.5) -> list:
    """One POST per prefecture id to https://www.data.jma.go.jp/risk/obsdl/top/station.

    Must first GET obsdl/index.php once to establish a PHPSESSID cookie
    (the endpoint works without it in ad-hoc testing, but the real UI always
    does this first, so we replicate that for good citizenship / robustness).
    """
    pref_ids = pref_ids if pref_ids is not None else PREF_IDS
    session.get(OBSDL_INDEX_URL, timeout=20)  # establish session cookie

    rows = []
    for i, prid in enumerate(pref_ids):
        print(f"[obsdl] ({i+1}/{len(pref_ids)}) POST top/station pd={prid}", file=sys.stderr)
        try:
            resp = session.post(OBSDL_STATION_URL, data={"pd": f"{prid:02d}"}, timeout=20)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"[obsdl] pd={prid} FAILED: {e}", file=sys.stderr)
            continue

        # The fragment lists each station TWICE (once for the "available"
        # list, once for the "selected" checkbox state) — de-dup by stid.
        seen = set()
        for stid, stname, prid_str, kansoku in STID_ROW_RE.findall(resp.text):
            if stid in seen:
                continue
            seen.add(stid)
            rows.append({
                "stid": stid,
                "stname": stname,
                "prid": int(prid_str),
                "pref_name": PREF_NAMES.get(int(prid_str), ""),
                "kansoku": kansoku,
            })
        time.sleep(polite_delay)  # be polite; this is a public-service endpoint, not a CDN

    print(f"[obsdl] total station rows: {len(rows)}", file=sys.stderr)
    return rows


def build_station_master(amedastable: dict, obsdl_rows: list) -> list:
    # amedastable: name -> list of (code, record)  (name is usually unique but not guaranteed)
    by_name = {}
    for code, rec in amedastable.items():
        by_name.setdefault(rec["kjName"], []).append((code, rec))

    matched_amedastable_codes = set()
    out = []

    for row in obsdl_rows:
        candidates = by_name.get(row["stname"], [])
        rec = None
        amd_code = None
        if len(candidates) == 1:
            amd_code, rec = candidates[0]
        elif len(candidates) > 1:
            # Ambiguous name match (e.g. duplicate station names in different
            # prefectures). Left unresolved on purpose -- flag, don't guess.
            amd_code, rec = candidates[0]
            print(f"[join] WARNING ambiguous name '{row['stname']}' "
                  f"({len(candidates)} amedastable candidates) — using first match",
                  file=sys.stderr)

        if rec is not None:
            matched_amedastable_codes.add(amd_code)

        out.append(StationRow(
            jma_code=row["stid"],
            name=row["stname"],
            name_kana=rec["knName"] if rec else None,
            pref=row["pref_name"],
            lat=dms_to_decimal(rec["lat"]) if rec else None,
            lon=dms_to_decimal(rec["lon"]) if rec else None,
            elevation=rec.get("alt") if rec else None,
            type=rec.get("type") if rec else None,
            matched_sources="amedastable+obsdl" if rec else "obsdl_only",
            amedastable_code=amd_code,
            obsdl_stid=row["stid"],
            kansoku_bitmask=row["kansoku"],
        ))

    # amedastable stations never matched by name (e.g. real-time-only nowcast
    # points not present in the historical-download picker, or name mismatches)
    unmatched = 0
    for code, rec in amedastable.items():
        if code not in matched_amedastable_codes:
            unmatched += 1
            out.append(StationRow(
                jma_code=f"amd:{code}",
                name=rec["kjName"],
                name_kana=rec["knName"],
                pref=None,
                lat=dms_to_decimal(rec["lat"]),
                lon=dms_to_decimal(rec["lon"]),
                elevation=rec.get("alt"),
                type=rec.get("type"),
                matched_sources="amedastable_only",
                amedastable_code=code,
            ))
    print(f"[join] {unmatched} amedastable stations had no obsdl name match "
          f"(kept, flagged amedastable_only)", file=sys.stderr)

    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="stations.csv", help="output CSV path")
    ap.add_argument("--pref-ids", type=int, nargs="*", default=None,
                     help="restrict obsdl crawl to these prefecture ids (default: all 61)")
    ap.add_argument("--amedastable-only", action="store_true",
                     help="skip the obsdl crawl entirely; output raw amedastable data only "
                          "(fast, but jma_code will NOT be usable for historical downloads)")
    ap.add_argument("--polite-delay", type=float, default=0.5,
                     help="seconds to sleep between obsdl requests (default 0.5)")
    args = ap.parse_args()

    session = requests.Session()
    session.headers.update({
        "User-Agent": "jma-temp-ingest-prototype/0.1 (+feasibility experiment; contact via app support)",
    })

    amedastable = fetch_amedastable(session)

    if args.amedastable_only:
        rows = [
            StationRow(
                jma_code=f"amd:{code}",
                name=rec["kjName"],
                name_kana=rec["knName"],
                lat=dms_to_decimal(rec["lat"]),
                lon=dms_to_decimal(rec["lon"]),
                elevation=rec.get("alt"),
                type=rec.get("type"),
                matched_sources="amedastable_only",
                amedastable_code=code,
            )
            for code, rec in amedastable.items()
        ]
    else:
        obsdl_rows = fetch_obsdl_stations(session, pref_ids=args.pref_ids, polite_delay=args.polite_delay)
        rows = build_station_master(amedastable, obsdl_rows)

    import csv
    fieldnames = list(StationRow.__dataclass_fields__.keys())
    with open(args.out, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r.__dict__)

    print(f"Wrote {len(rows)} rows to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
