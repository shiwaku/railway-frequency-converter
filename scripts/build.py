#!/usr/bin/env python3
"""data/normalized/ の GeoJSON から tippecanoe で PMTiles を生成し dist/ に出力する。

- 出力は「データセット × 年」で 1 ファイル: dist/unkohonsu{year}_{dataset}.pmtiles
- レイヤ名はデータセット名（年に依存しない）に統一し、MapLibre 側で
  同じスタイルを全年に流用できるようにする。
- tippecanoe オプションは config/datasets.json の各データセットに定義。
"""
from __future__ import annotations

import argparse
import subprocess
import sys

from common import DIST_DIR, NORM_DIR, iter_targets, load_config


def build_one(ds: dict, stem: str, force: bool) -> str:
    src = NORM_DIR / f"{stem}.geojson"
    dest = DIST_DIR / f"{stem}.pmtiles"
    if not src.exists():
        raise FileNotFoundError(f"normalized が無い: {src}")
    if dest.exists() and not force and dest.stat().st_mtime >= src.stat().st_mtime:
        return "skip"

    cmd = [
        "tippecanoe", "-q", "-f",
        "-o", str(dest),
        "-l", ds["name"],           # レイヤ名 = データセット名（全年共通）
        "-n", stem,                  # タイルセット名
        *ds.get("tippecanoe", []),
        str(src),
    ]
    subprocess.run(cmd, check=True)
    return "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="既存でも再生成する")
    args = parser.parse_args()

    config = load_config()
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    total = ok = skipped = 0
    for _year, ds, stem in iter_targets(config):
        total += 1
        try:
            result = build_one(ds, stem, args.force)
        except Exception as exc:  # noqa: BLE001
            print(f"[FAIL] {stem}: {exc}", file=sys.stderr)
            return 1
        dest = DIST_DIR / f"{stem}.pmtiles"
        size_mb = dest.stat().st_size / 1048576 if dest.exists() else 0
        if result == "ok":
            ok += 1
        else:
            skipped += 1
        print(f"[{result.upper():4}] {stem}.pmtiles ({size_mb:.2f} MB)")

    print(f"\nbuild: {ok} built, {skipped} skipped, {total} total -> {DIST_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
