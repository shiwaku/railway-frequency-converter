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

# Git Bash(MSYS) は `/foo` の形の値を Windows パスに変換してしまい、
# VITE_PMTILES_BASE に `C:/Program Files/Git/...` が焼き込まれた壊れたビルドになる。
# MSYS_NO_PATHCONV / MSYS2_ARG_CONV_EXCL で変換を止める（他環境では無害な変数）。
(cd viewer && npm install &&   MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'   VITE_PMTILES_BASE="${PAGES_BASE}/pmtiles" npm run build)

# 焼き込まれた base を検証する。ここを間違えると「基図だけ出てデータが出ない」
# 状態で公開されてしまい、ビルド時にはエラーが出ないので気づけない。
if ! grep -rq "${PAGES_BASE}/pmtiles" viewer/dist/assets/*.js; then
  echo "ERROR: ビルドに ${PAGES_BASE}/pmtiles が含まれていない。VITE_PMTILES_BASE が壊れている。" >&2
  grep -roh "pmtiles[^\"']\{0,60\}" viewer/dist/assets/*.js | sort -u | head >&2
  exit 1
fi

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
