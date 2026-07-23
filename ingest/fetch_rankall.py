#!/usr/bin/env python3
"""
fetch_rankall.py — JMA 歴代全国ランキング (all-time nationwide extreme-value
ranking) ingestion prototype. Stream 2 of the feasibility experiment;
see FINDINGS.md.

Two variants of this data exist, both confirmed live and working in this
sandbox:

  (1) NATIONAL top-20, by month or year-round
      GET https://www.data.jma.go.jp/stats/etrn/view/rankall.php
          ?prec_no=&block_no=&year=&month=&day=&view=
      (month can also be selected via rankall01.php..rankall12.php, or by
      passing month=1..12; empty params = year-round "通年").
      Format: several <table class="data2_s"> blocks per page, one per
      element (最高気温の高い方から, 最低気温の低い方から, ...), each with a
      <caption> naming the element and rows of
      (順位, 都道府県, 地点, 観測値, 起日, 現在観測を実施).
      Ties share a rank shown as "〃" (ditto) instead of a repeated number.
      A trailing " *" on a station name below is JMA's own footnote marker
      (station relocated/instrument changed; see the page's legend) — treat
      as a data-quality flag, not part of the name.

  (2) PER-STATION top-10, all elements, with 統計期間 (obs_start/obs_end)
      GET https://www.data.jma.go.jp/stats/etrn/view/rank_s.php
          ?prec_no=<prec_no>&block_no=<block_no>
      block_no is the SAME number as fetch_stations.py's obsdl "stid" with
      its leading letter stripped (s47662 -> block_no=47662; a0365 ->
      block_no=0365). prec_no is the obsdl prefecture id ("prid").
      Verified live: prec_no=44&block_no=47675 (大島) returns a table
      including "日最高気温の高い方から (℃)" with 10 (value, date) pairs and
      a 統計期間 column ("1938/11  2026/7") — this is your obs_start /
      obs_end source for stations.obs_start, IF you need per-station rather
      than the crude "type" field.
      NOT every block_no works: prec_no=44&block_no=0365 (小河内, a rain-only
      AMeDAS point) returned "ページを表示することが出来ませんでした" (page
      could not be displayed) — likely because that endpoint requires an
      "officially graded" 5-digit block_no, not because it never has data
      (see FINDINGS.md — this is a separate, so-far-unresolved discrepancy
      with the actual-value check that showed 4-digit-block AMeDAS points DO
      have downloadable temperature via obsdl's show/table).

This script implements (1), because that is what the task named
("歴代全国ランキング"). It's a small, GET-only, no-session-cookie-needed
HTML scrape — the cheapest/highest-value stream to build first.

Usage:
    pip install -r requirements.txt
    python fetch_rankall.py                       # year-round, national, all elements on the page
    python fetch_rankall.py --month 8              # August-only ranking
"""

import argparse
import re
import sys

import requests
from bs4 import BeautifulSoup

RANKALL_URL = "https://www.data.jma.go.jp/stats/etrn/view/rankall.php"


def fetch_rankall(month: int = None) -> str:
    params = {"prec_no": "", "block_no": "", "year": "", "month": month or "", "day": "", "view": ""}
    resp = requests.get(RANKALL_URL, params=params, timeout=20)
    resp.raise_for_status()
    resp.encoding = "utf-8"  # confirmed via response headers: text/html; charset=UTF-8
    return resp.text


def parse_rankall(html: str) -> list:
    """Returns a list of dicts: element, rank, pref, station, value, date, station_note, still_observing."""
    soup = BeautifulSoup(html, "lxml")
    rows_out = []

    for table in soup.select("table.data2_s"):
        caption = table.find("caption")
        element_name = caption.get_text(strip=True) if caption else "(unknown)"
        # strip the parenthetical explanation JMA appends to the caption
        element_name = re.sub(r"\s*\(.*", "", element_name)

        last_rank = None
        for tr in table.select("tr.mtx"):
            th = tr.find("th")
            tds = tr.find_all("td")
            if th is None or len(tds) < 4:
                continue  # header row
            rank_text = th.get_text(strip=True)
            rank = last_rank if rank_text == "〃" else rank_text
            last_rank = rank

            pref, station_raw, value, date, *rest = [td.get_text(strip=True) for td in tds]
            still_observing = (rest[0] == "○") if rest else None
            station_note = station_raw.endswith("*") or station_raw.endswith("＊")
            station = station_raw.rstrip("* ＊").strip()

            rows_out.append({
                "element": element_name,
                "rank": rank,
                "pref": pref,
                "station": station,
                "value": value,
                "date": date,
                "station_note": station_note,
                "still_observing": still_observing,
            })

    return rows_out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--month", type=int, default=None, help="1-12, omit for year-round (通年)")
    ap.add_argument("--out", default=None, help="CSV output path (default: print to stdout)")
    args = ap.parse_args()

    print(f"[rankall] GET {RANKALL_URL} month={args.month or '(year-round)'}", file=sys.stderr)
    html = fetch_rankall(args.month)
    rows = parse_rankall(html)
    print(f"[rankall] parsed {len(rows)} rows across "
          f"{len({r['element'] for r in rows})} element tables", file=sys.stderr)

    if args.out:
        import csv
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {args.out}", file=sys.stderr)
    else:
        for r in rows:
            if r["element"].startswith("最高気温"):
                print(r)


if __name__ == "__main__":
    main()
