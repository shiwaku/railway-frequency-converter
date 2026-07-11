# 全国鉄道運行本数 PMTiles パイプライン

[gtfs-gis.jp の「全国鉄道運行本数データ」](https://gtfs-gis.jp/railway_honsu/) を
ダウンロード → 正規化 → **PMTiles** に変換し、MapLibre 等でベクタータイル配信できる形にする
自動パイプライン。

- 元データライセンス: **CC-BY 4.0 / ODbL**（出典: gtfs-gis.jp）
- 対象: 全 5 データセット × 全 4 年（2023–2026）＝ **20 ファイル**

## データセット

| データセット | ジオメトリ | 内容 | PMTiles(1年あたり) |
|---|---|---|---:|
| `rosen_kukan` | LineString | 路線別・区間別運行本数 | ~6 MB |
| `kukan` | LineString | 区間別運行本数 | ~6 MB |
| `rosen_eki` | Point | 路線別・駅別発着本数 | ~4.8 MB |
| `eki` | Point | 事業者別・駅別発着本数（プロパティ最大110列） | ~10.5 MB |
| `kukan_eki` | Point | 区間端の駅（軽量） | ~1 MB |

全年・全データセット合計は **約 110–130 MB**。

## パイプライン

```
data/raw/         ← download.py   gtfs-gis.jp から GeoJSON を取得
data/normalized/  ← normalize.py  前処理（下記）
dist/             ← build.py      tippecanoe で PMTiles 生成
```

出力ファイル名は `unkohonsu{年}_{データセット}.pmtiles`。
PMTiles 内のレイヤ名は **データセット名（年に依存しない）** に統一しているので、
MapLibre 側で同じスタイルを全年に流用できる。

### 前処理（normalize.py）でやること

このデータには変換前に対処が必要な癖がある:

1. **geometry.type が大文字**（`"LINESTRING"` / `"POINT"`）。GeoJSON 標準は
   `LineString` / `Point` で、tippecanoe は大文字を弾くため正規化する。
2. **本数プロパティの年サフィックスが不揃い**:
   - 2023 ファイル → `順方向運行本数2023` / `逆方向運行本数2023`
   - 2024・2025・2026 ファイル → いずれも `…2024`（ファイル年と一致しない）

   このままだと年ごとにプロパティキーが変わり MapLibre のスタイリングで扱いづらいので、
   年に依存しない**安定キー**を付与する（元プロパティも保持）:

   | 追加プロパティ | 意味 |
   |---|---|
   | `honsu_fwd` | 順方向運行本数（整数） |
   | `honsu_rev` | 逆方向運行本数（整数） |
   | `honsu_total` | 順方向＋逆方向（線の色分けに便利） |
   | `count_year` | 本数の集計年（元ラベルの年） |
   | `data_year` | データ版の年（ファイル名の年） |

## ローカル実行

前提: `python3`、`tippecanoe`（v2.80 で確認）。

```bash
make            # download → normalize → build → 一覧表示
make download   # 取得のみ
make normalize  # 正規化のみ
make build      # PMTiles 生成のみ
make manifest   # dist/ の一覧と合計サイズ
make clean      # 中間ファイル・成果物を削除
```

再取得・再生成を強制する場合は各スクリプトに `--force`
（`python3 scripts/download.py --force` 等）。

対象年・データセット・tippecanoe オプションは [`config/datasets.json`](config/datasets.json) で変更できる。

## Web ビューア (`viewer/`)

生成した PMTiles を確認・デモ表示するための **Vite + TypeScript** アプリ。
背景は国土地理院の最適化ベクトルタイル（淡色地図）で、ダーク/ライト切替に対応する。

```bash
cd viewer
npm install
npm run dev       # 開発サーバー（HMR, http://localhost:8000/）
npm run build     # 本番ビルド → viewer/dist/
npm run preview   # ビルド結果の確認
```

- 開発サーバーはリポジトリ直下 `dist/` の PMTiles を `/pmtiles` から **Range(206) 対応**で配信する（`vite.config.ts` のミドルウェア）。先に `make build` で PMTiles を生成しておくこと。
- 本番配信では PMTiles を置いた URL を `viewer/.env` の `VITE_PMTILES_BASE` に指定する（未設定時は `/pmtiles`）。
- 5 データセットをトグルで重畳表示。線は運行本数（`honsu_total`）、点は発着本数で色分け（実分布に合わせた単一色相の連続ランプ）。

## GitHub Actions

[`.github/workflows/build-pmtiles.yml`](.github/workflows/build-pmtiles.yml):

- **手動実行** (`workflow_dispatch`): `force` / `publish_release` を指定可能
- **push**: `config/` `scripts/` `Makefile` 変更時に自動ビルド
- **毎月**: 元データ更新の取り込み（cron）

成果物は Actions の **artifact**（`railway-honsu-pmtiles`）として保存。
手動実行で `publish_release=true` にすると **GitHub Releases**（タグ `pmtiles-latest`）にも公開する。

## 配信（MapLibre から利用）

PMTiles は **HTTP Range リクエスト対応の静的ホスティング**があれば配信できる
（サーバー側プログラム不要）。主要な国内レンタルサーバー（Apache / nginx）はそのまま対応する。

必要に応じてサーバー側で設定:
- `.pmtiles` の `Content-Type`（`application/octet-stream` で可）
- CORS: `Access-Control-Allow-Origin`
- Range: `Accept-Ranges: bytes`（通常デフォルトで有効）

MapLibre での読み込み例（`pmtiles` プロトコル使用）:

```js
import { Protocol } from "pmtiles";
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

map.addSource("kukan", {
  type: "vector",
  url: "pmtiles://https://example.com/tiles/unkohonsu2026_kukan.pmtiles",
});
map.addLayer({
  id: "kukan",
  type: "line",
  source: "kukan",
  "source-layer": "kukan",
  paint: {
    "line-width": 2,
    // honsu_total（本数合計）で色分け（実分布に合わせた単一色相ランプ）
    "line-color": [
      "interpolate", ["linear"], ["coalesce", ["get", "honsu_total"], 0],
      0, "#cfe3fb", 100, "#88b8f0", 300, "#3987e5", 600, "#1c5cab", 900, "#0d366b"
    ],
  },
});
```
