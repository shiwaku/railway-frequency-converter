PYTHON ?= python3

.PHONY: all download normalize build clean clean-dist manifest deploy-pages

all: build manifest

download:
	$(PYTHON) scripts/download.py

normalize: download
	$(PYTHON) scripts/normalize.py

build: normalize
	$(PYTHON) scripts/build.py

# dist/ の一覧と合計サイズを出力
manifest:
	@echo "=== dist/ PMTiles ==="
	@ls -l dist/*.pmtiles 2>/dev/null | awk '{printf "%-38s %8.2f MB\n", $$9, $$5/1048576}' || true
	@du -ck dist/*.pmtiles 2>/dev/null | tail -1 | awk '{printf "TOTAL: %.2f MB\n", $$1/1024}' || true

# ビューア + PMTiles を GitHub Pages (gh-pages ブランチ) へデプロイ
deploy-pages:
	bash scripts/deploy-pages.sh

# 中間ファイルと成果物を削除
clean:
	rm -rf data/raw/* data/normalized/* dist/*

# 成果物のみ削除
clean-dist:
	rm -rf dist/*
