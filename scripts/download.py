#!/usr/bin/env python3
"""gtfs-gis.jp から鉄道運行本数 GeoJSON を data/raw/ にダウンロードする。

- config/datasets.json の years × datasets の全組み合わせを取得。
- 既存ファイルがありサイズが妥当ならスキップ（--force で再取得）。
- curl を使い、リトライとリダイレクト追従を行う。
"""
from __future__ import annotations

import argparse
import subprocess
import sys

from common import RAW_DIR, iter_targets, load_config


def download_one(url: str, dest, force: bool) -> str:
    if dest.exists() and dest.stat().st_size > 1024 and not force:
        return "skip"
    tmp = dest.with_suffix(dest.suffix + ".part")
    cmd = [
        "curl", "-fsSL", "--retry", "3", "--retry-delay", "2",
        "--connect-timeout", "30", "-o", str(tmp), url,
    ]
    subprocess.run(cmd, check=True)
    if tmp.stat().st_size <= 1024:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"downloaded file too small: {url}")
    tmp.replace(dest)
    return "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="既存でも再取得する")
    args = parser.parse_args()

    config = load_config()
    base = config["base_url"]
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    total = ok = skipped = 0
    for _year, _ds, stem in iter_targets(config):
        total += 1
        url = f"{base}/{stem}.geojson"
        dest = RAW_DIR / f"{stem}.geojson"
        try:
            result = download_one(url, dest, args.force)
        except Exception as exc:  # noqa: BLE001
            print(f"[FAIL] {stem}: {exc}", file=sys.stderr)
            return 1
        if result == "ok":
            ok += 1
        else:
            skipped += 1
        size_mb = dest.stat().st_size / 1048576
        print(f"[{result.upper():4}] {stem}.geojson ({size_mb:.1f} MB)")

    print(f"\ndownload: {ok} fetched, {skipped} skipped, {total} total -> {RAW_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
