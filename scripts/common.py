"""共通ユーティリティ: config 読み込みとファイル名規約。"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "datasets.json"

RAW_DIR = ROOT / "data" / "raw"
NORM_DIR = ROOT / "data" / "normalized"
DIST_DIR = ROOT / "dist"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def stem(prefix: str, year: int, dataset: str) -> str:
    """例: unkohonsu2026_kukan"""
    return f"{prefix}{year}_{dataset}"


def iter_targets(config: dict):
    """(year, dataset_dict, stem) を列挙する。"""
    prefix = config["file_prefix"]
    for year in config["years"]:
        for ds in config["datasets"]:
            yield year, ds, stem(prefix, year, ds["name"])
