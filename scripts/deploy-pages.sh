#!/usr/bin/env bash
# ビューアをビルドし、PMTiles を同梱して gh-pages ブランチへデプロイする。
# 公開 URL: https://shiwaku.github.io/railway-frequency-converter/
# 前提: make build 済みで dist/*.pmtiles が存在すること。
set -euo pipefail
cd "$(dirname "$0")/.."

# GitHub Pages のサブパス（リポジトリ名）
PAGES_BASE="/railway-frequency-converter"

ls dist/*.pmtiles >/dev/null 2>&1 || {
  echo "ERROR: dist/*.pmtiles がない。先に make build を実行すること。" >&2
  exit 1
}

(cd viewer && npm install && VITE_PMTILES_BASE="${PAGES_BASE}/pmtiles" npm run build)

mkdir -p viewer/dist/pmtiles
cp dist/*.pmtiles viewer/dist/pmtiles/
touch viewer/dist/.nojekyll

# gh-pages ブランチは履歴を持たず、毎回作り直して force push する
REMOTE_URL=$(git remote get-url origin)
cd viewer/dist
rm -rf .git
git init -q
git checkout -qb gh-pages
git add -A
git commit -qm "Deploy to GitHub Pages"
git push -f "$REMOTE_URL" gh-pages
rm -rf .git

echo "Deployed: https://shiwaku.github.io${PAGES_BASE}/"
