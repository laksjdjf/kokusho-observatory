#!/usr/bin/env python3
"""hf_store.py — 生データ（日別最高気温）の永続化を HuggingFace Datasets で行う。

役割分担:
  - 正準データ = HF上の Parquet（daily_max.parquet / stations.parquet）
  - SQLite     = Parquetから毎回組み立てる使い捨てのクエリ用インデックス（Git管理外）

SQLite(620MB) に対し Parquet(zstd) は約19MB。バージョン管理・CDN配信・
データビューアが付くHFに置くのが最も筋が良い。

認証:
  ローカル … `hf auth login`（~/.cache/huggingface に保存）
  CI      … 環境変数 HF_TOKEN（GitHub Secrets）

使い方:
    uv run python hf_store.py export            # SQLite -> data/parquet/
    uv run python hf_store.py push              # data/parquet/ -> HF
    uv run python hf_store.py pull              # HF -> data/parquet/
    uv run python hf_store.py import            # data/parquet/ -> SQLite
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "max_temp.sqlite"
PARQUET_DIR = DATA_DIR / "parquet"
DAILY_PQ = "daily_max.parquet"
STATIONS_PQ = "stations.parquet"

REPO_ID = os.environ.get("HF_DATASET_REPO", "furusu/japan-max-temperature")
SOURCE_NOTE = "出典：気象庁ホームページを加工して作成"

DATASET_CARD = """---
license: other
language: [ja]
tags: [weather, japan, temperature, climate, jma]
pretty_name: 日本の日別最高気温（気象官署＋アメダス）
---

# 日本の日別最高気温データセット

気象庁が公開する観測データから、**日別の最高気温**のみを抽出・整形したもの。
気象官署とアメダス（歴代ランキング掲載の記録保持地点を含む）を収録している。

| ファイル | 内容 |
|---|---|
| `daily_max.parquet` | 日別最高気温（station_id, date, max_temp, quality_flag） |
| `stations.parquet` | 観測地点マスタ（jma_code, 名称, 都道府県, 緯度経度, 標高, 観測開始日） |

`daily_max.station_id` は `stations.id` に対応する。

## 出典・ライセンス

**出典：気象庁ホームページ**（<https://www.data.jma.go.jp/>）を加工して作成。

気象庁の「公共データ利用規約（第1.0版）」に基づき、出典を明記のうえ利用・再配布しています。
本データは上記を**加工・再構成したもの**であり、公式発表値と差異が生じた場合は
気象庁の公表値を正とします。予報・警報等の目的には使用しないでください。

## 生成元

<https://github.com/laksjdjf/kokusho-observatory>
"""


def _api():
    from huggingface_hub import HfApi
    return HfApi(token=os.environ.get("HF_TOKEN") or None)


def export_parquet() -> None:
    """SQLite -> Parquet（型を締めて zstd 圧縮）"""
    if not DB_PATH.exists():
        sys.exit(f"SQLiteがありません: {DB_PATH}")
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)

    daily = pd.read_sql("SELECT station_id,date,max_temp,quality_flag FROM daily_max", con)
    daily["station_id"] = daily["station_id"].astype("int16")
    daily["date"] = pd.to_datetime(daily["date"]).dt.date
    # 気温は0.1℃刻み。float32にすると 39.8 が 39.79999923706055 になって
    # 往復で誤差が残るため float64 のまま保持し、念のため1桁に丸める。
    # （zstd圧縮が効くのでサイズ差はわずか）
    daily["max_temp"] = daily["max_temp"].astype("float64").round(1)
    daily["quality_flag"] = daily["quality_flag"].astype("category")
    daily.to_parquet(PARQUET_DIR / DAILY_PQ, compression="zstd", index=False)

    st = pd.read_sql("SELECT * FROM stations", con)
    st.to_parquet(PARQUET_DIR / STATIONS_PQ, compression="zstd", index=False)
    con.close()

    for f in (DAILY_PQ, STATIONS_PQ):
        p = PARQUET_DIR / f
        print(f"[export] {f}: {p.stat().st_size:,} bytes", file=sys.stderr)
    print(f"[export] {len(daily):,}行", file=sys.stderr)


def import_parquet() -> None:
    """Parquet -> SQLite（インデックス込みで再構築）"""
    dpq, spq = PARQUET_DIR / DAILY_PQ, PARQUET_DIR / STATIONS_PQ
    if not dpq.exists():
        sys.exit(f"Parquetがありません: {dpq}（先に pull してください）")
    if DB_PATH.exists():
        DB_PATH.unlink()

    import build_daily  # スキーマ定義を共有
    con = sqlite3.connect(DB_PATH)
    con.executescript(build_daily.SCHEMA)

    st = pd.read_parquet(spq)
    st.to_sql("stations", con, if_exists="append", index=False)

    daily = pd.read_parquet(dpq)
    daily["date"] = daily["date"].astype(str)
    # 過去に float32 で保存された版を読んだ場合の誤差を落とす（0.1℃刻みに正規化）
    daily["max_temp"] = daily["max_temp"].astype("float64").round(1)
    daily["max_temp_time"] = None
    daily["quality_flag"] = daily["quality_flag"].astype(str)
    daily[["station_id", "date", "max_temp", "max_temp_time", "quality_flag"]].to_sql(
        "daily_max", con, if_exists="append", index=False, chunksize=100_000)

    for idx in build_daily.INDEXES:
        con.execute(idx)
    con.execute("ANALYZE")
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM daily_max").fetchone()[0]

    # 地点マスタは滅多に変わらないので、日次実行では obsdl を61都道府県ぶん
    # 再クロール（約50秒）せずにここから stations.json を復元する。
    cols = [c for c in ("jma_code", "amedastable_code", "name", "name_kana", "pref",
                        "lat", "lon", "elevation", "type") if c in st.columns]
    stations = st[cols].where(pd.notna(st[cols]), None).to_dict("records")
    json.dump({"meta": {"source": SOURCE_NOTE, "restored_from": REPO_ID,
                        "count": len(stations)},
               "stations": stations},
              open(DATA_DIR / "stations.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    con.close()
    print(f"[import] SQLite再構築: {n:,}行 / {DB_PATH.stat().st_size:,} bytes", file=sys.stderr)
    print(f"[import] stations.json を復元: {len(stations)}地点", file=sys.stderr)


def push() -> None:
    api = _api()
    api.create_repo(REPO_ID, repo_type="dataset", exist_ok=True)
    card = PARQUET_DIR / "README.md"
    card.write_text(DATASET_CARD, encoding="utf-8")
    for f in (DAILY_PQ, STATIONS_PQ, "README.md"):
        api.upload_file(path_or_fileobj=str(PARQUET_DIR / f), path_in_repo=f,
                        repo_id=REPO_ID, repo_type="dataset",
                        commit_message=f"update {f}")
        print(f"[push] {f} -> {REPO_ID}", file=sys.stderr)
    print(f"[push] https://huggingface.co/datasets/{REPO_ID}", file=sys.stderr)


def pull() -> None:
    from huggingface_hub import hf_hub_download
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    for f in (DAILY_PQ, STATIONS_PQ):
        p = hf_hub_download(REPO_ID, f, repo_type="dataset",
                            token=os.environ.get("HF_TOKEN") or None)
        dest = PARQUET_DIR / f
        dest.write_bytes(Path(p).read_bytes())
        print(f"[pull] {f}: {dest.stat().st_size:,} bytes", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["export", "import", "push", "pull"])
    args = ap.parse_args()
    {"export": export_parquet, "import": import_parquet, "push": push, "pull": pull}[args.cmd]()


if __name__ == "__main__":
    main()
