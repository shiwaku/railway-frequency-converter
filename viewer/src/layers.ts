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
  /**
   * feature-state 用の一意プロパティ名。
   * tippecanoe はフィーチャ ID を振らないので promoteId でプロパティを昇格させる。
   * これを持たないデータセット（kukan_eki）はホバーハイライトできない。
   */
  idProp?: string
  /**
   * 円半径スケールのドメイン上限。全 4 年の実測 max（本数）:
   *   eki 4568 / rosen_eki 1542
   * データセットごとに桁が違うので共通ドメインだと片方が潰れる。
   */
  valueMax?: number
  /** 排他グループ。同じグループのレイヤーは同時に 1 つだけ表示する。 */
  exclusive?: 'line'
}

/** 描画順: 配列の後ろほど手前（点を線の上に置く） */
export const LAYERS: LayerDef[] = [
  { key: 'rosen_kukan', label: '路線別区間', geom: 'line', on: true, idProp: 'ID', exclusive: 'line' },
  { key: 'kukan', label: '区間別（全事業者合算）', geom: 'line', on: false, idProp: 'ID', exclusive: 'line' },
  { key: 'eki', label: '駅発着', geom: 'point', on: true, idProp: 'ID', valueMax: 4600 },
  { key: 'rosen_eki', label: '路線別駅発着', geom: 'point', on: false, idProp: 'ID', valueMax: 1600 },
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

// 線: honsu_total（実分布 p50≈95, p90≈460, max≈1939）
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

/** ホバー中フィーチャの強調色。ランプ（青・緑）と衝突しない色相を使う。 */
const HOVER_COLOR = '#ff8a3d'

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

const isHovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false]

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

const HONSU_TOTAL: ExpressionSpecification = ['coalesce', ['to-number', ['get', 'honsu_total'], 0], 0]

/**
 * 面積比例（r ∝ √値）の半径ストップを作る。
 * 発着本数の分布は右に強く歪んでおり（p50≈150 に対し max≈4568）、
 * 線形補間だと大半の駅が最小半径付近に固まって差が読めない。
 */
function radiusStops(valueMax: number, rMin: number, rMax: number): number[] {
  const fractions = [0, 0.02, 0.06, 0.15, 0.35, 0.65, 1]
  const out: number[] = []
  for (const f of fractions) {
    out.push(Math.round(valueMax * f), Number((rMin + (rMax - rMin) * Math.sqrt(f)).toFixed(2)))
  }
  return out
}

/**
 * MapLibre は 1 つの式に zoom ベースの interpolate を 1 つしか許さないので、
 * ズーム補間を必ず最外側に置き、ホバー時の拡大は各ズームストップの内側で分岐させる。
 */
const ptRadius = (
  expr: ExpressionSpecification,
  valueMax: number,
  hoverScale: number,
): ExpressionSpecification => {
  const at = (rMin: number, rMax: number, s: number): ExpressionSpecification =>
    ['interpolate', ['linear'], expr, ...radiusStops(valueMax, rMin * s, rMax * s)] as ExpressionSpecification
  const stop = (rMin: number, rMax: number): ExpressionSpecification =>
    ['case', isHovered, at(rMin, rMax, hoverScale), at(rMin, rMax, 1)] as ExpressionSpecification
  return ['interpolate', ['linear'], ['zoom'],
    6, stop(1.1, 4),
    10, stop(1.8, 8),
    13, stop(2.6, 14),
  ] as ExpressionSpecification
}

/**
 * 線幅も本数に連動させる（色＋太さの二重符号化）。
 * 色だけだと低ズームで幹線と支線の区別がつきにくい。
 */
const lineWidth = (hoverScale: number): ExpressionSpecification => {
  const at = (min: number, max: number, s: number): ExpressionSpecification =>
    ['interpolate', ['linear'], HONSU_TOTAL,
      0, min * s,
      150, (min + (max - min) * 0.35) * s,
      450, (min + (max - min) * 0.7) * s,
      900, max * s,
    ] as ExpressionSpecification
  // ズーム補間は最外側に 1 つだけ（ptRadius と同じ制約）
  const stop = (min: number, max: number): ExpressionSpecification =>
    ['case', isHovered, at(min, max, hoverScale), at(min, max, 1)] as ExpressionSpecification
  return ['interpolate', ['linear'], ['zoom'],
    6, stop(0.9, 2.8),
    10, stop(1.7, 5.5),
    13, stop(2.6, 9),
  ] as ExpressionSpecification
}

type LayerPaint =
  | Pick<LineLayerSpecification, 'type' | 'paint'>
  | Pick<CircleLayerSpecification, 'type' | 'paint'>

export function paintFor(def: LayerDef, theme: Theme): LayerPaint {
  const strokeLight = 'rgba(255,255,255,0.85)'
  const strokeDark = 'rgba(0,0,0,0.55)'
  const stroke = theme === 'dark' ? strokeDark : strokeLight
  const canHover = Boolean(def.idProp)

  if (def.geom === 'line') {
    const color = interpFromRamp(HONSU_TOTAL, LINE_RAMP, theme)
    return {
      type: 'line',
      paint: {
        'line-width': lineWidth(canHover ? 1.8 : 1),
        'line-color': canHover
          ? (['case', isHovered, HOVER_COLOR, color] as ExpressionSpecification)
          : color,
        'line-opacity': 0.9,
      },
    }
  }

  const expr = HASSAKU[def.key]
  if (expr) {
    const max = def.valueMax ?? 2500
    const color = interpFromRamp(expr, POINT_RAMP, theme)
    return {
      type: 'circle',
      paint: {
        'circle-radius': ptRadius(expr, max, canHover ? 1.3 : 1),
        'circle-color': ['case', isHovered, HOVER_COLOR, color],
        'circle-opacity': 0.9,
        'circle-stroke-color': ['case', isHovered, HOVER_COLOR, stroke],
        'circle-stroke-width': ['case', isHovered, 2.2, 0.8],
      },
    }
  }

  // kukan_eki: 本数も一意 ID も持たない → 位置のみの控えめな点（ハイライト無し）
  return {
    type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 13, 4],
      'circle-color': theme === 'dark' ? '#9aa0a6' : '#5f6368',
      'circle-stroke-color': stroke,
      'circle-stroke-width': 0.6,
    },
  }
}

// ---- ツールチップ（ホバー: 要点のみ） / ポップアップ（クリック: 詳細） ----

/** プロパティは外部データなので innerHTML に入れる前に必ずエスケープする。 */
function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

const num = (v: unknown): number => Number(v ?? 0) || 0
/** 桁区切り。本数は最大 4568 だが年次合計等で 4 桁を超えるため入れておく。 */
const fmt = (v: unknown): string => num(v).toLocaleString('ja-JP')

function hassakuTotal(key: string, p: Record<string, unknown>): number {
  if (key === 'eki') return num(p['両方向発着計'])
  return num(p['着数1']) + num(p['発数1']) + num(p['着数2']) + num(p['発数2'])
}

/** 集計年。点データには count_year が付かないので版年 data_year にフォールバックする。 */
function countYear(p: Record<string, unknown>): string {
  return esc(p['count_year'] ?? p['data_year'] ?? '')
}

export function hoverHtml(key: string, p: Record<string, unknown>): string {
  const g = (k: string): string => esc(p[k])
  if (key === 'kukan') {
    // 区間別: 同一区間を走る全路線・全事業者の列車を合算した本数
    return `<b>${g('路線名')} 区間</b> ｜ 全列車計 ${fmt(p['honsu_total'])}本/日`
  }
  if (key === 'rosen_kukan') {
    return `<b>${g('路線名')}</b> ｜ 計 ${fmt(p['honsu_total'])}本/日`
  }
  if (key === 'eki' || key === 'rosen_eki') {
    // 発着計 = 発本数 + 着本数（列車1本が発・着で2回計上されうる）
    return `<b>${g('駅名')}</b> ｜ 発着計 ${fmt(hassakuTotal(key, p))}本/日`
  }
  return `<b>${g('EkiName')}</b> ｜ ${g('RName')}`
}

export function popupHtml(key: string, p: Record<string, unknown>): string {
  const g = (k: string): string => esc(p[k])
  if (key === 'rosen_kukan' || key === 'kukan') {
    const isKukan = key === 'kukan'
    const title = isKukan ? `${g('路線名')} 区間` : g('路線名')
    const note = isKukan
      ? `<div class="pp-note">この区間を走る全路線・全事業者の列車を合算した本数</div>`
      : ''
    return (
      `<div class="pp-title">${title}</div>` +
      `<div class="pp-sub">${g('起点駅')} → ${g('終点駅')}</div>` +
      note +
      `<dl class="pp-dl">` +
      `<dt>順方向</dt><dd>${fmt(p['honsu_fwd'])}本/日</dd>` +
      `<dt>逆方向</dt><dd>${fmt(p['honsu_rev'])}本/日</dd>` +
      `<dt>合計</dt><dd class="pp-strong">${fmt(p['honsu_total'])}本/日</dd>` +
      `</dl><div class="pp-foot">${countYear(p)}年版（平日）${isKukan ? '' : ` ｜ ${g('事業者名')}`}</div>`
    )
  }
  if (key === 'eki') {
    return (
      `<div class="pp-title">${g('駅名')}</div>` +
      `<div class="pp-sub">${g('事業者名')}</div>` +
      `<dl class="pp-dl">` +
      `<dt>両方向発着計</dt><dd class="pp-strong">${fmt(p['両方向発着計'])}</dd>` +
      `<dt>方向1発着</dt><dd>${fmt(p['方向１発着計'])}</dd>` +
      `<dt>方向2発着</dt><dd>${fmt(p['方向２発着計'])}</dd>` +
      `<dt>乗入路線数</dt><dd>${fmt(p['路線数'])}</dd>` +
      `</dl>` +
      `<div class="pp-foot">${countYear(p)}年版 ｜ 発着計＝発本数＋着本数（平日1日）</div>`
    )
  }
  if (key === 'rosen_eki') {
    // 方向ラベル（向き1/向き2）はデータ側が「下り」「上り」等を持つ
    const d1 = String(p['向き1'] ?? '方向1')
    const d2 = String(p['向き2'] ?? '方向2')
    return (
      `<div class="pp-title">${g('駅名')}</div>` +
      `<div class="pp-sub">${g('路線名')} ｜ ${g('事業者名')}</div>` +
      `<dl class="pp-dl">` +
      `<dt>発着計</dt><dd class="pp-strong">${fmt(hassakuTotal(key, p))}</dd>` +
      `<dt>${esc(d1)}（着/発）</dt><dd>${fmt(p['着数1'])} / ${fmt(p['発数1'])}</dd>` +
      `<dt>${esc(d2)}（着/発）</dt><dd>${fmt(p['着数2'])} / ${fmt(p['発数2'])}</dd>` +
      `</dl>` +
      `<div class="pp-foot">${countYear(p)}年版 ｜ 発着計＝発本数＋着本数（平日1日）</div>`
    )
  }
  return (
    `<div class="pp-title">${g('EkiName')}</div>` +
    `<div class="pp-sub">${g('RName')} ｜ ${g('JName')}</div>` +
    `<div class="pp-foot">${countYear(p)}年版 ｜ 区間端の駅（本数データなし）</div>`
  )
}
