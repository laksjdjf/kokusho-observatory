#!/usr/bin/env python3
"""build_geo.py — 地図用の日本の輪郭GeoJSONを軽量化して web/public/japan.geojson を作る。

元データ（都道府県ポリゴン、約13MB）はそのままだと重いので:
  1. 微小な島ポリゴンを面積で除去
  2. shapely.simplify で座標を間引き
  3. 座標を小数3桁（約100m精度）に丸め
country-scale の表示には十分な精度を保ちつつ数百KBに落とす。

元データ出典: https://github.com/dataofjapan/land （国土数値情報 由来）

使い方:
    uv run python build_geo.py --src /path/to/japan_raw.geojson
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "japan.geojson"


def round_coords(obj, nd=3):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(c), nd) for c in obj]
        return [round_coords(o, nd) for o in obj]
    return obj


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="元の japan.geojson")
    ap.add_argument("--tolerance", type=float, default=0.008, help="simplify 許容誤差(度)")
    ap.add_argument("--min-area", type=float, default=0.0012, help="除去する島の面積下限(平方度)")
    args = ap.parse_args()

    src = json.load(open(args.src, encoding="utf-8"))
    feats_out = []
    dropped = 0

    for f in src["features"]:
        geom = shape(f["geometry"])
        # マルチポリゴンから微小な島を落とす
        parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        keep = [p for p in parts if p.area >= args.min_area]
        dropped += len(parts) - len(keep)
        if not keep:
            # 全部小さい県（島嶼のみ等）は最大の1つだけ残す
            keep = [max(parts, key=lambda p: p.area)]
        merged = unary_union(keep)
        simp = merged.simplify(args.tolerance, preserve_topology=True)
        if simp.is_empty:
            continue
        props = f.get("properties", {})
        feats_out.append({
            "type": "Feature",
            "properties": {"pref": props.get("nam_ja"), "id": props.get("id")},
            "geometry": round_coords(mapping(simp)),
        })

    out = {"type": "FeatureCollection",
           "note": "出典: 国土数値情報（dataofjapan/land）を簡略化",
           "features": feats_out}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    size = OUT.stat().st_size
    print(f"[geo] {len(feats_out)}都道府県 / 微小島 {dropped}個除去 / "
          f"{OUT.relative_to(OUT.parents[2])} {size:,} bytes", file=sys.stderr)


if __name__ == "__main__":
    main()
