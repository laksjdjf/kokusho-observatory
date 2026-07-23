#!/usr/bin/env python3
"""bootstrap.py — clone直後の環境を1コマンドで開発可能にする。

リポジトリにはデータを置いていないので、HuggingFace から生データ(Parquet)を
取得して SQLite を組み立て、フロントが読む派生JSONまで一気に生成する。
気象庁へのアクセスは発生しない（歴代ランキングだけは別途 build_data.py）。

    uv run python bootstrap.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

STEPS = [
    (["python", "hf_store.py", "pull"], "HuggingFace から Parquet を取得"),
    (["python", "hf_store.py", "import"], "SQLite を再構築"),
    (["python", "build_views.py"], "派生ビュー（昨日/地点/猛暑日回数）を生成"),
    (["python", "build_dates.py"], "日付ごとのランキングを生成"),
]


def main() -> None:
    for i, (cmd, label) in enumerate(STEPS, 1):
        print(f"\n=== [{i}/{len(STEPS)}] {label} ===", file=sys.stderr)
        r = subprocess.run(["uv", "run", *cmd], cwd=HERE)
        if r.returncode != 0:
            sys.exit(f"失敗: {' '.join(cmd)}")
    print("\n✓ 完了。`cd ../web && npm install && npm run dev` で起動できます。", file=sys.stderr)
    print("  歴代全国ランキングも更新する場合は "
          "`uv run python build_data.py --with-stations`（気象庁へアクセスします）", file=sys.stderr)


if __name__ == "__main__":
    main()
