#!/usr/bin/env python3
"""data/raw/ の GeoJSON を tippecanoe が扱える形に正規化して data/normalized/ に出力する。

このデータ固有の前処理:
  1. geometry.type が大文字 ("LINESTRING"/"POINT" 等) なので GeoJSON 標準の
     キャメルケース ("LineString"/"Point") に修正する。tippecanoe は大文字を弾く。
  2. 全フィーチャに data_year (ファイル名の年) を付与する。
  3. 運行本数プロパティの年サフィックスが不揃い
     (2023 ファイル=…2023、2024/2025/2026 ファイル=…2024) なので、
     "順方向運行本数YYYY"/"逆方向運行本数YYYY" を検出し、
     年に依存しない安定キー honsu_fwd / honsu_rev / honsu_total と
     元ラベルの年 count_year を付与する（元プロパティは保持）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys

from common import NORM_DIR, RAW_DIR, iter_targets, load_config

# GeoJSON 標準の型名（大文字 → キャメルケース）
GEOM_TYPE_MAP = {
    "POINT": "Point",
    "MULTIPOINT": "MultiPoint",
    "LINESTRING": "LineString",
    "MULTILINESTRING": "MultiLineString",
    "POLYGON": "Polygon",
    "MULTIPOLYGON": "MultiPolygon",
    "GEOMETRYCOLLECTION": "GeometryCollection",
}

FWD_RE = re.compile(r"^順方向運行本数(\d{4})$")
REV_RE = re.compile(r"^逆方向運行本数(\d{4})$")


def fix_geometry_type(geom: dict) -> None:
    if not geom:
        return
    t = geom.get("type")
    if isinstance(t, str) and t in GEOM_TYPE_MAP:
        geom["type"] = GEOM_TYPE_MAP[t]
    # GeometryCollection 内も再帰的に
    for sub in geom.get("geometries", []) or []:
        fix_geometry_type(sub)


def _to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def add_stable_honsu(props: dict) -> None:
    fwd = rev = None
    count_year = None
    for key, value in list(props.items()):
        m = FWD_RE.match(key)
        if m:
            fwd = _to_int(value)
            count_year = int(m.group(1))
            continue
        m = REV_RE.match(key)
        if m:
            rev = _to_int(value)
            count_year = int(m.group(1))
    if fwd is None and rev is None:
        return  # 本数プロパティを持たないデータセット（駅点データ等）
    if fwd is not None:
        props["honsu_fwd"] = fwd
    if rev is not None:
        props["honsu_rev"] = rev
    if fwd is not None or rev is not None:
        props["honsu_total"] = (fwd or 0) + (rev or 0)
    if count_year is not None:
        props["count_year"] = count_year


def normalize_file(src, dest, year: int) -> tuple[int, set[str]]:
    with src.open(encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    geom_types: set[str] = set()
    for feat in features:
        fix_geometry_type(feat.get("geometry"))
        geom = feat.get("geometry")
        if geom and geom.get("type"):
            geom_types.add(geom["type"])
        props = feat.setdefault("properties", {})
        props["data_year"] = year
        add_stable_honsu(props)

    with dest.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return len(features), geom_types


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="既存でも再生成する")
    args = parser.parse_args()

    config = load_config()
    NORM_DIR.mkdir(parents=True, exist_ok=True)

    total = 0
    for year, _ds, stem in iter_targets(config):
        src = RAW_DIR / f"{stem}.geojson"
        dest = NORM_DIR / f"{stem}.geojson"
        if not src.exists():
            print(f"[MISS] {stem}: raw が無い（先に download を実行）", file=sys.stderr)
            return 1
        if dest.exists() and not args.force and dest.stat().st_mtime >= src.stat().st_mtime:
            print(f"[SKIP] {stem}")
            continue
        n, gtypes = normalize_file(src, dest, year)
        total += 1
        print(f"[OK  ] {stem}: {n} features, geom={sorted(gtypes)}")

    print(f"\nnormalize: {total} files written -> {NORM_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
