import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
} from 'maplibre-gl'
import type { Theme } from './theme'

export type Geom = 'line' | 'point'

export interface LayerDef {
  /** データセット名。PMTiles ファイル名・source-layer 名と一致する。 */
  key: string
  label: string
  geom: Geom
  /** 初期表示 ON/OFF */
  on: boolean
}

/** 描画順: 配列の後ろほど手前（点を線の上に置く） */
export const LAYERS: LayerDef[] = [
  { key: 'rosen_kukan', label: '路線別区間', geom: 'line', on: true },
  { key: 'kukan', label: '区間別', geom: 'line', on: true },
  { key: 'eki', label: '駅発着', geom: 'point', on: true },
  { key: 'rosen_eki', label: '路線別駅発着', geom: 'point', on: false },
  { key: 'kukan_eki', label: '区間端の駅', geom: 'point', on: false },
]

// ---- 連続値ランプ（単一色相・明→暗）。値が大きいほど各サーフェスで目立つ向きにする。
//   light: 背景が明るい → 高い値 = 暗い（濃紺 / 濃緑）
//   dark : 背景が暗い   → 高い値 = 明るい（水色 / 薄緑）
// 線 = ブルー、点 = アクア（2つ目の連続文脈は次の色相を使う）。

interface Ramp {
  stops: number[]
  light: string[]
  dark: string[]
}

// 線: honsu_total（実分布 p50≈95, p90≈460, max≈1934）
export const LINE_LEGEND = [0, 100, 300, 600, 900]
const LINE_RAMP: Ramp = {
  stops: LINE_LEGEND,
  light: ['#cfe3fb', '#88b8f0', '#3987e5', '#1c5cab', '#0d366b'],
  dark: ['#16345f', '#20599f', '#3987e5', '#79b0ee', '#c8e0fb'],
}

// 点: 発着本数（実分布 p50≈150, p90≈700, max≈4568）
export const POINT_LEGEND = [0, 150, 500, 1200, 2500]
const POINT_RAMP: Ramp = {
  stops: POINT_LEGEND,
  light: ['#d6f2e6', '#7ed9b0', '#1baf7a', '#0f7d55', '#0a5238'],
  dark: ['#0c3f2c', '#0f7d55', '#1baf7a', '#5fd3a0', '#c7f0dd'],
}

/** 色ランプ配列をカラーの値まで LEGEND を色分けで表示するため公開。 */
export function rampColors(kind: Geom, theme: Theme): { stops: number[]; colors: string[] } {
  const r = kind === 'line' ? LINE_RAMP : POINT_RAMP
  return { stops: r.stops, colors: theme === 'dark' ? r.dark : r.light }
}

function interpFromRamp(input: ExpressionSpecification, r: Ramp, theme: Theme): ExpressionSpecification {
  const colors = theme === 'dark' ? r.dark : r.light
  const pairs: (number | string)[] = []
  r.stops.forEach((s, i) => pairs.push(s, colors[i]))
  return ['interpolate', ['linear'], input, ...pairs] as ExpressionSpecification
}

/**
 * 点の発着本数の取り出し方はデータセットごとに異なる。
 * - eki: 集計済みプロパティ「両方向発着計」
 * - rosen_eki: 集計プロパティが無いため 着数/発数 を実行時に合算
 */
const HASSAKU: Record<string, ExpressionSpecification> = {
  eki: ['to-number', ['get', '両方向発着計'], 0],
  rosen_eki: [
    '+',
    ['to-number', ['get', '着数1'], 0],
    ['to-number', ['get', '発数1'], 0],
    ['to-number', ['get', '着数2'], 0],
    ['to-number', ['get', '発数2'], 0],
  ],
}

const ptRadius = (expr: ExpressionSpecification): ExpressionSpecification => [
  'interpolate', ['linear'], ['zoom'],
  6, ['interpolate', ['linear'], expr, 0, 1.5, 2500, 5],
  13, ['interpolate', ['linear'], expr, 0, 3, 2500, 14],
]

type LayerPaint =
  | Pick<LineLayerSpecification, 'type' | 'paint'>
  | Pick<CircleLayerSpecification, 'type' | 'paint'>

export function paintFor(def: LayerDef, theme: Theme): LayerPaint {
  const strokeLight = 'rgba(255,255,255,0.85)'
  const strokeDark = 'rgba(0,0,0,0.55)'
  if (def.geom === 'line') {
    return {
      type: 'line',
      paint: {
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 12, 4.5],
        'line-color': interpFromRamp(['coalesce', ['get', 'honsu_total'], 0], LINE_RAMP, theme),
        'line-opacity': 0.9,
      },
    }
  }

  const expr = HASSAKU[def.key]
  if (expr) {
    return {
      type: 'circle',
      paint: {
        'circle-radius': ptRadius(expr),
        'circle-color': interpFromRamp(expr, POINT_RAMP, theme),
        'circle-opacity': 0.9,
        'circle-stroke-color': theme === 'dark' ? strokeDark : strokeLight,
        'circle-stroke-width': 0.8,
      },
    }
  }

  // kukan_eki: 本数を持たない → 位置のみの控えめな点
  return {
    type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 13, 4],
      'circle-color': theme === 'dark' ? '#9aa0a6' : '#5f6368',
      'circle-stroke-color': theme === 'dark' ? strokeDark : strokeLight,
      'circle-stroke-width': 0.6,
    },
  }
}

// ---- ツールチップ（ホバー: 要点のみ） / ポップアップ（クリック: 詳細） ----

function hassakuTotal(key: string, p: Record<string, unknown>): number {
  if (key === 'eki') return Number(p['両方向発着計'] ?? 0) || 0
  const n = (k: string): number => Number(p[k] ?? 0) || 0
  return n('着数1') + n('発数1') + n('着数2') + n('発数2')
}

export function hoverHtml(key: string, p: Record<string, unknown>): string {
  const g = (k: string): string => String(p[k] ?? '')
  if (key === 'rosen_kukan' || key === 'kukan') {
    return `<b>${g('路線名')}</b> ｜ 計 ${g('honsu_total')}本`
  }
  if (key === 'eki' || key === 'rosen_eki') {
    return `<b>${g('駅名')}</b> ｜ 発着 ${hassakuTotal(key, p)}本`
  }
  return `<b>${g('EkiName')}</b>`
}

export function popupHtml(key: string, p: Record<string, unknown>): string {
  const g = (k: string): string => String(p[k] ?? '')
  if (key === 'rosen_kukan' || key === 'kukan') {
    return (
      `<div class="pp-title">${g('路線名')}</div>` +
      `<div class="pp-sub">${g('起点駅')} → ${g('終点駅')}</div>` +
      `<dl class="pp-dl">` +
      `<dt>順方向</dt><dd>${g('honsu_fwd')}</dd>` +
      `<dt>逆方向</dt><dd>${g('honsu_rev')}</dd>` +
      `<dt>合計</dt><dd class="pp-strong">${g('honsu_total')}</dd>` +
      `</dl><div class="pp-foot">${g('count_year')}年集計 ｜ ${g('事業者名')}</div>`
    )
  }
  if (key === 'eki') {
    return (
      `<div class="pp-title">${g('駅名')}</div>` +
      `<div class="pp-sub">${g('事業者名')}</div>` +
      `<dl class="pp-dl">` +
      `<dt>両方向発着計</dt><dd class="pp-strong">${g('両方向発着計')}</dd>` +
      `<dt>方向1発着</dt><dd>${g('方向１発着計')}</dd>` +
      `<dt>方向2発着</dt><dd>${g('方向２発着計')}</dd>` +
      `<dt>乗入路線数</dt><dd>${g('路線数')}</dd>` +
      `</dl>`
    )
  }
  if (key === 'rosen_eki') {
    return (
      `<div class="pp-title">${g('駅名')}</div>` +
      `<div class="pp-sub">${g('路線名')} ｜ ${g('事業者名')}</div>` +
      `<dl class="pp-dl"><dt>着発計</dt><dd class="pp-strong">${hassakuTotal(key, p)}</dd></dl>`
    )
  }
  return `<div class="pp-title">${g('EkiName')}</div><div class="pp-sub">${g('RName')}</div>`
}
