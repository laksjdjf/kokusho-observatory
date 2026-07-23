#!/usr/bin/env python3
"""
fetch_obsdl_sample.py — JMA 過去の気象データ・ダウンロード (obsdl) prototype
for a single station's daily max temperature (最高気温), over a date range.
Stream 3 of the feasibility experiment; see FINDINGS.md.

CONFIRMED LIVE END-TO-END in this sandbox (2026-07-22):
  session = requests.Session()
  session.get("https://www.data.jma.go.jp/risk/obsdl/index.php")   # cookie
  session.post("https://www.data.jma.go.jp/risk/obsdl/show/table", data={...})
    -> with downloadFlag=false: JSON preview (used to sanity-check values)
    -> with downloadFlag=true + csvFlag=1: a real Shift_JIS-ish... actually
       UTF-8-decodable-as-cp932 CSV body (Content-Disposition: attachment)
  Real sample returned for station s47662 (Tokyo), 2024-07-01..05, element
  202 (最高気温):
      2024,7,1,29.4,8,1
      2024,7,2,31.4,8,1
      2024,7,3,33.3,8,1
      2024,7,4,35.0,8,1
      2024,7,5,35.5,8,1
  (columns after day: 最高気温(℃), 品質情報 [quality flag 1-8], 均質番号
  [homogeneity/continuity number] — see ingest/samples/daily_max_tokyo_sample.csv)

KEY PARAMETERS (reverse-engineered from web/js/top.2.1.js on the obsdl page):
  stationNumList   JSON list of station ids, e.g. '["s47662"]'.
                   Get these from fetch_stations.py's `jma_code`/`obsdl_stid`
                   column (NOT from amedastable.json's numeric codes).
  aggrgPeriod      "1" = daily values (what we want). Other values: 2=半旬,
                   4=旬, 5=月, 6=3か月, 7=年, 9=時別, 8=N日間.
  elementNumList   JSON list of [code, extra] pairs. "202" = 最高気温
                   (single daily max value) -- confirmed by scraping the
                   "top/element" fragment (see samples/element_daily.html).
                   Related but DIFFERENT codes seen on the same page:
                     201 平均気温 (daily mean), 203 最低気温 (daily min),
                     204 日最高気温の平均 (monthly-aggregate mean-of-daily-max,
                     NOT what you want for a per-day max-temp app).
  ymdList          JSON list [startYear, endYear, startMonth, endMonth,
                   startDay, endDay] as strings.
  optionNumList    JSON list, "[]" if no extra options (平年値表示 etc).
  downloadFlag     "false" -> body is JSON (small on-screen preview, capped
                   at ~mumble rows/page); "true" -> body is a CSV file.
  csvFlag          "1" when downloadFlag=true, selects comma-separated CSV
                   (the tool also supports a "整形" fixed-width text mode).
  rmkFlag          "1" to include 品質情報/均質番号 columns (recommended --
                   these map directly onto this project's quality_flag).
  disconnectFlag, youbiFlag, fukenFlag, kijiFlag, jikantaiFlag, jikantaiList
                   Various display toggles; "0"/"1" is safe for all of them
                   for a headless daily-value pull. interAnnualType="1" means
                   "continuous period" (vs. "same month across many years").

VOLUME / RATE LIMITS (from top.2.1.js, `var seigen = 44000`):
  The tool enforces (n_stations * n_elements * n_days * n_options) <= 44000
  per request (with a small ×1.5 weight for N-day-average aggregations).
  For a single station + single element (our case), that's ~44000 days
  (~120 years) per request -- i.e. one station's ENTIRE history normally
  fits in ONE request. Pulling many stations at once requires chunking
  (e.g. 10 stations x 1 element needs <=4400 days, ~12 years, per request).
  There is no documented official rate limit beyond this; be polite anyway
  (delay between requests, identify your client, don't parallelize heavily --
  this is a public-service tool run by a government agency, not a paid API).

LICENSING: JMA data is free to use under 公共データ利用規約(第1.0版), but you
MUST cite the source (出典：気象庁ホームページ + URL) wherever the data is
displayed or redistributed. See ingest/samples/kiyaku.html (fetched live)
and FINDINGS.md.

Usage:
    pip install -r requirements.txt
    python fetch_obsdl_sample.py --stid s47662 --start 2024-07-01 --end 2024-07-05
    python fetch_obsdl_sample.py --stid s47662 --start 1990-01-01 --end 2024-12-31 --out tokyo_full.csv
"""

import argparse
import io
import sys
from datetime import date

import requests

OBSDL_INDEX_URL = "https://www.data.jma.go.jp/risk/obsdl/index.php"
OBSDL_TABLE_URL = "https://www.data.jma.go.jp/risk/obsdl/show/table"

ELEMENT_MAX_TEMP = "202"  # 最高気温 (daily max) -- see module docstring


def build_payload(stid: str, start: date, end: date, download: bool) -> dict:
    return {
        "stationNumList": f'["{stid}"]',
        "aggrgPeriod": "1",
        "elementNumList": f'[["{ELEMENT_MAX_TEMP}",""]]',
        "interAnnualType": "1",
        "ymdList": f'["{start.year}","{end.year}","{start.month}","{end.month}","{start.day}","{end.day}"]',
        "optionNumList": "[]",
        "downloadFlag": "true" if download else "false",
        "csvFlag": "1",
        "selectedPageNum": "1",
        "rmkFlag": "1",          # include 品質情報 (quality) + 均質番号 (homogeneity) columns
        "disconnectFlag": "1",
        "kijiFlag": "0",
        "youbiFlag": "0",
        "fukenFlag": "0",
        "jikantaiFlag": "0",
        "jikantaiList": "[]",
        # NOTE: deliberately NOT sending ymdLiteral. Sending ymdLiteral=1
        # (as top.2.1.js does) switches the date column to a single combined
        # "2024/7/1" string; omitting it (as our first successful curl test
        # did) yields separate 年,月,日 integer columns, which is what
        # parse_daily_max_csv() below expects. Both were confirmed live.
    }


def fetch_preview_json(session: requests.Session, stid: str, start: date, end: date) -> dict:
    """downloadFlag=false variant: small JSON preview, good for a quick sanity check
    before committing to a full CSV pull."""
    resp = session.post(OBSDL_TABLE_URL, data=build_payload(stid, start, end, download=False), timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_csv(session: requests.Session, stid: str, start: date, end: date) -> str:
    """downloadFlag=true variant: real CSV file body. Server sends it as
    application/octet-stream with Content-Disposition: attachment; the text
    itself decodes as cp932 (Shift_JIS-family), NOT UTF-8."""
    resp = session.post(OBSDL_TABLE_URL, data=build_payload(stid, start, end, download=True), timeout=60)
    resp.raise_for_status()
    # cp932(Shift_JIS系)。長期間データには稀にNEC特殊文字等の解読不能バイトが
    # 混じるが、利用する数値列(年月日・気温・品質)には影響しないため errors=replace。
    return resp.content.decode("cp932", errors="replace")


def build_payload_multi(stids, start: date, end: date) -> dict:
    """複数地点をまとめて1リクエストで取得するためのpayload。

    obsdlの制限は 地点数 × 要素数 × 日数 × オプション数 <= 44000。
    1要素なので「地点数 × 日数 <= 44000」。差分取込（十数日）なら
    全地点を1〜2リクエストに畳める。
    """
    payload = build_payload(stids[0], start, end, download=True)
    payload["stationNumList"] = "[" + ",".join(f'"{s}"' for s in stids) + "]"
    return payload


def fetch_csv_multi(session: requests.Session, stids, start: date, end: date) -> str:
    resp = session.post(OBSDL_TABLE_URL, data=build_payload_multi(stids, start, end), timeout=120)
    resp.raise_for_status()
    return resp.content.decode("cp932", errors="replace")


def parse_daily_max_csv_multi(csv_text: str, stids) -> dict:
    """複数地点CSVを {stid: [row, ...]} に分解する。

    レイアウト（1要素・rmkFlag=1）:
        年,月,日, [地点1] 値,品質情報,均質番号, [地点2] 値,品質情報,均質番号, ...
    列の順序は stationNumList の順に対応するので、地点名ではなく位置で対応づける
    （同名地点があっても取り違えない）。
    """
    out = {s: [] for s in stids}
    for line in csv_text.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3 + len(stids) * 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        year, month, day = parts[0], parts[1], parts[2]
        iso = f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
        for i, stid in enumerate(stids):
            value, quality = parts[3 + i * 3], parts[4 + i * 3]
            if not value:
                continue
            try:
                temp = float(value)
            except ValueError:
                continue
            out[stid].append({
                "station_id": stid, "date": iso, "max_temp": temp,
                "max_temp_time": None, "quality_flag": quality or None,
            })
    return out


def parse_daily_max_csv(csv_text: str, station_id: str) -> list:
    """Parses the obsdl daily-max CSV shape into daily_max rows:
    (station_id, date, max_temp, quality_flag). Note: this CSV format has
    NO max_temp_time column for the 最高気温 element alone -- if the target
    schema's max_temp_time is required, you'd need a second element (e.g. a
    time-of-max element, if JMA exposes one for daily aggregation) or accept
    NULL for max_temp_time on this stream.
    """
    import csv as csv_mod
    lines = csv_text.splitlines()
    # Layout (rmkFlag=1, 1 station, 1 element):
    #   line0: download timestamp
    #   line1: blank
    #   line2: ,,,<station>,<station>,<station>
    #   line3: 年,月,日,最高気温(℃),最高気温(℃),最高気温(℃)
    #   line4: blank
    #   line5: ,,,,品質情報,均質番号
    #   line6+: data rows
    data_start = None
    for i, line in enumerate(lines):
        parts = line.split(",")
        if len(parts) >= 3 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
            data_start = i
            break
    if data_start is None:
        return []

    rows = []
    for line in lines[data_start:]:
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6 or not parts[0].isdigit():
            continue
        year, month, day, value, quality, homogeneity = parts[:6]
        rows.append({
            "station_id": station_id,
            "date": f"{int(year):04d}-{int(month):02d}-{int(day):02d}",
            "max_temp": float(value) if value else None,
            "max_temp_time": None,  # not present in this element's CSV shape
            "quality_flag": quality or None,
        })
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stid", required=True, help='obsdl station id, e.g. "s47662" (Tokyo) or "a0393" (野沢温泉)')
    ap.add_argument("--start", required=True, help="YYYY-MM-DD")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD")
    ap.add_argument("--out", default=None, help="CSV output path for parsed daily_max rows (default: print)")
    ap.add_argument("--preview-only", action="store_true", help="use the JSON preview endpoint instead of real CSV")
    args = ap.parse_args()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)

    session = requests.Session()
    session.headers.update({"User-Agent": "jma-temp-ingest-prototype/0.1 (+feasibility experiment)"})
    print(f"[obsdl] GET {OBSDL_INDEX_URL} (session init)", file=sys.stderr)
    session.get(OBSDL_INDEX_URL, timeout=20)

    if args.preview_only:
        print(f"[obsdl] POST show/table (preview) stid={args.stid} {start}..{end}", file=sys.stderr)
        data = fetch_preview_json(session, args.stid, start, end)
        print(data)
        return

    print(f"[obsdl] POST show/table (CSV) stid={args.stid} {start}..{end}", file=sys.stderr)
    csv_text = fetch_csv(session, args.stid, start, end)
    rows = parse_daily_max_csv(csv_text, args.stid)
    print(f"[obsdl] parsed {len(rows)} daily_max rows", file=sys.stderr)

    if args.out:
        import csv as csv_mod
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv_mod.DictWriter(f, fieldnames=["station_id", "date", "max_temp", "max_temp_time", "quality_flag"])
            w.writeheader()
            w.writerows(rows)
        print(f"Wrote {len(rows)} rows to {args.out}", file=sys.stderr)
    else:
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
