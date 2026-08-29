import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  LineLayerSpecification,
} from 'maplibre-gl'
import { oklch } from './color'
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
   * 色・太さ/半径スケールの区切り。全 4 年の実測分位（p50 / p75 / p90 / p98）を採る。
   * データセットごとに分布のレンジが 2〜4 倍違うので、共通スケールだと
   * 片方は最上位クラスに到達せず（rosen_kukan の実測 max は 771）、
   * 片方は上位が飽和する。上限を超える値は最上位クラスに丸める（凡例の "+"）。
   * 持たないデータセット（kukan_eki）は本数を持たないので省略。
   */
  stops?: number[]
  /** 排他グループ。同じグループのレイヤーは同時に 1 つだけ表示する。 */
  exclusive?: 'line'
  /**
   * 事業者種別の判定に使うプロパティ名。データセットごとに列名が違う。
   * 省略時は '事業者コード' / '路線コード'。
   * `kukan` は区間内の全事業者を合算した値なのに事業者コードは代表 1 社しか持たない。
   * 種別で塗り分けると合算値を 1 社のものと誤読させるので、意図的に持たせない。
   */
  opProp?: string
  lineProp?: string
}

/** 描画順: 配列の後ろほど手前（点を線の上に置く） */
export const LAYERS: LayerDef[] = [
  // stops は全 4 年の実測分位 p50 / p75 / p90 / p98（末尾が上限＝以降は同色）
  { key: 'rosen_kukan', label: '路線別区間', geom: 'line', on: true, idProp: 'ID', exclusive: 'line', stops: [0, 100, 280, 440, 620], opProp: '事業者コード', lineProp: '路線コード' },
  { key: 'kukan', label: '区間別（全事業者合算）', geom: 'line', on: false, idProp: 'ID', exclusive: 'line', stops: [0, 100, 290, 470, 700] },
  // eki は駅単位（事業者別）で路線コードを直接持たないので、代表として路線１のコードで判定する
  { key: 'eki', label: '駅発着', geom: 'point', on: true, idProp: 'ID', stops: [0, 150, 430, 710, 1270], opProp: '事業者コード', lineProp: '路線１_路線コード' },
  { key: 'rosen_eki', label: '路線別駅発着', geom: 'point', on: false, idProp: 'ID', stops: [0, 150, 420, 680, 1070], opProp: '事業者コード', lineProp: '路線コード' },
  { key: 'kukan_eki', label: '区間端の駅', geom: 'point', on: false, opProp: 'JCode', lineProp: 'RCode' },
]

// ---- 事業者種別 ----
// gtfs-gis.jp の `事業者コード` は国土数値情報と同じ 3 桁で、先頭桁が種別を表す:
//   1xx JR / 2xx 大手私鉄・公営地下鉄 / 3xx・4xx 中小私鉄・第三セクター
//   5xx のうち 501–518 モノレール・新交通、551–560 路面電車
// ただし **路面電車は事業者コードだけでは切れない**。鉄道線と軌道線を併有する
// 事業者が 1 つのコードにまとまっているため（都営＝地下鉄＋荒川線 など）、
// 路線コード単位の例外表を持つ。

export type Category = 'jr' | 'major' | 'local' | 'newtransit' | 'tram'

export interface CategoryDef {
  key: Category
  label: string
  /** ランプの色相（HSL の H）。種別＝色相、運行本数＝明度＋太さ で二重符号化する。 */
  hue: number
}

// 色相は OKLCH の角度。5 種別が互いに最も離れる組み合わせを選んだ（最小 60 度）。
// 青 / オーキッド / 緑 / マスタード / テラコッタ。
export const CATEGORIES: CategoryDef[] = [
  { key: 'jr', label: 'JR', hue: 258 },
  { key: 'major', label: '大手私鉄・地下鉄', hue: 320 },
  { key: 'local', label: '中小私鉄・三セク', hue: 155 },
  { key: 'newtransit', label: 'モノレール・新交通', hue: 95 },
  { key: 'tram', label: '路面電車', hue: 30 },
]

/**
 * 全線が軌道の事業者。広島電鉄は路線名が系統名（「1・2・5・6号線」等）で、
 * 鉄道線の宮島線が系統に溶け込んでおりデータ上分離できないため事業者ごと路面電車とする。
 */
const TRAM_OPERATORS = [436]

/**
 * 鉄道線と軌道線を併有する事業者の、軌道側の路線（`事業者コード-路線コード`）。
 * 富山港線は鉄道事業法の路線だが市内線と直通する LRT 運行なので路面電車に含める。
 */
const TRAM_LINES = [
  '211-7', // 東急 世田谷線
  '218-6', // 東京都 荒川線
  '225-6', // 京阪 京津線
  '225-7', // 京阪 石山坂本線
  '351-1', // 万葉線
  '354-4', // 富山地方鉄道 市内線本線
  '354-5', // 富山地方鉄道 環状線
  '354-6', // 富山地方鉄道 富山港線
  '358-1', // 福井鉄道 福武線
  '358-2', // 福井鉄道 福井駅線
  '373-2', // 豊橋鉄道 東田本線
  '373-3', // 豊橋鉄道 東田本線分岐線
  '453-4', // 伊予鉄道 1系統・2系統
  '453-5', // 伊予鉄道 3系統
  '453-6', // 伊予鉄道 5系統
  '453-7', // 伊予鉄道 6系統
]

/** 札幌市営地下鉄だけコードが 5xx 帯にあるので、地下鉄として扱う。 */
const SUBWAY_IN_5XX = [501]

/** 分類本体。式（地図）と関数（ポップアップ）で同じ表を使うため 1 か所に置く。 */
export function categoryOf(op: number, line: number): Category {
  const key = `${op}-${line}`
  if ((op >= 551 && op <= 560) || TRAM_OPERATORS.includes(op) || TRAM_LINES.includes(key)) return 'tram'
  if (SUBWAY_IN_5XX.includes(op)) return 'major'
  if (op >= 501 && op <= 518) return 'newtransit'
  if (op < 200) return 'jr'
  if (op < 300) return 'major'
  return 'local'
}

export const categoryLabel = (c: Category): string =>
  CATEGORIES.find((x) => x.key === c)?.label ?? c

/** ポップアップ用。地図の式と同じ表を通すので分類がずれない。 */
export function categoryOfProps(def: LayerDef, p: Record<string, unknown>): Category | null {
  if (!def.opProp || !def.lineProp) return null
  const op = Number(p[def.opProp] ?? 0) || 0
  const line = Number(p[def.lineProp] ?? 0) || 0
  return categoryOf(op, line)
}

/** MapLibre 式版。categoryOf と同じ順序で判定する。 */
export function categoryExpr(def: LayerDef): ExpressionSpecification | null {
  if (!def.opProp || !def.lineProp) return null
  const op: ExpressionSpecification = ['to-number', ['get', def.opProp], 0]
  const key: ExpressionSpecification = [
    'concat',
    ['to-string', op],
    '-',
    ['to-string', ['to-number', ['get', def.lineProp], 0]],
  ]
  return [
    'case',
    ['any',
      ['all', ['>=', op, 551], ['<=', op, 560]],
      ['in', op, ['literal', TRAM_OPERATORS]],
      ['in', key, ['literal', TRAM_LINES]],
    ], 'tram',
    ['in', op, ['literal', SUBWAY_IN_5XX]], 'major',
    ['all', ['>=', op, 501], ['<=', op, 518]], 'newtransit',
    ['<', op, 200], 'jr',
    ['<', op, 300], 'major',
    'local',
  ] as ExpressionSpecification
}

// ---- 色ランプ（OKLCH）----
// 種別＝色相 H / 運行本数＝明度 L の二重符号化。L と C は全種別で共通に固定するので、
// 「同じ本数のフィーチャは種別が違っても同じ明るさに見える」が成り立つ。
// この不変性のおかげで、凡例の数値スケールは無彩色バー 1 本で足りる（色相キーは
// 種別フィルタのチップが兼ねる）。25 個の色見本を並べる必要がない。
//   light: 背景が明るい → 高い値 = 暗い
//   dark : 背景が暗い   → 高い値 = 明るい
// C（彩度）は両端で落とす。明るすぎ・暗すぎる色は高彩度を保てず色域外に出るため。

const LIGHT_L = [0.88, 0.775, 0.66, 0.51, 0.36]
const LIGHT_C = [0.05, 0.09, 0.13, 0.135, 0.105]
const DARK_L = [0.4, 0.52, 0.65, 0.78, 0.9]
const DARK_C = [0.095, 0.125, 0.14, 0.11, 0.06]

/** 種別を持てない `kukan` と、凡例の数値スケール用の無彩色ランプ。 */
const NEUTRAL_HUE = 250

export function rampColors(cat: Category | null, theme: Theme): string[] {
  const ls = theme === 'dark' ? DARK_L : LIGHT_L
  const cs = theme === 'dark' ? DARK_C : LIGHT_C
  const def = cat ? CATEGORIES.find((c) => c.key === cat) : undefined
  const hue = def?.hue ?? NEUTRAL_HUE
  // 種別なしは彩度をほぼ落とす。どれか 1 種別の色を流用すると
  // 「その種別の値」に見えてしまうため。
  const scale = def ? 1 : 0.08
  return ls.map((l, i) => oklch(l, cs[i] * scale, hue))
}

/** 凡例と地図で同じ区切りを使うため公開する。 */
export function stopsFor(def: LayerDef): number[] {
  return def.stops ?? []
}

/**
 * ホバー強調色。5 種別が色相を使い切っているので、どの色相とも衝突しない
 * **無彩色の最大コントラスト**を当てる（明度だけは本数と同じ軸に乗るが、
 * 彩度 0 と 1.8 倍の線幅で「強調」だと読める）。
 */
const HOVER_COLOR = { light: '#101418', dark: '#ffffff' } as const

/** 本数を持たないデータセット（kukan_eki）の色。 */
export const PLAIN_COLOR = { light: '#5f6368', dark: '#9aa0a6' } as const

function colorExpr(def: LayerDef, input: ExpressionSpecification, theme: Theme): ExpressionSpecification {
  const stops = stopsFor(def)
  const cat = categoryExpr(def)
  const rampAt = (c: Category | null): ExpressionSpecification => {
    const colors = rampColors(c, theme)
    const pairs: (number | string)[] = []
    stops.forEach((s, i) => pairs.push(s, colors[i]))
    return ['interpolate', ['linear'], input, ...pairs] as ExpressionSpecification
  }
  if (!cat) return rampAt(null)
  const cases: unknown[] = ['match', cat]
  for (const c of CATEGORIES) cases.push(c.key, rampAt(c.key))
  cases.push(rampAt('local')) // 既定
  return cases as ExpressionSpecification
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

/** そのレイヤーが符号化している値（線＝運行本数合計 / 点＝発着計）。 */
function valueExpr(def: LayerDef): ExpressionSpecification | null {
  if (def.geom === 'line') return HONSU_TOTAL
  return HASSAKU[def.key] ?? null
}

/**
 * 描画順。sort-key は昇順（大きいほど手前）なので符号を反転し、
 * **本数の多い＝太い/大きいフィーチャを下に**敷く。
 * 都心部では最大 9 本の区間が同じ線形に、7 点の駅が同じ座標に重なる。
 * 既定（タイル内の格納順）のままだと細い線・小さい円が太い線・大きい円を
 * 覆い隠し、太さ/面積による符号化が読めなくなる。
 */
const sortKey = (expr: ExpressionSpecification): ExpressionSpecification =>
  ['-', 0, expr] as ExpressionSpecification

/**
 * 面積比例（r ∝ √値）の半径ストップを作る。
 * 発着本数の分布は右に強く歪んでおり（p50≈150 に対し p98≈1270）、
 * 線形補間だと大半の駅が最小半径付近に固まって差が読めない。
 * 上限（stops 末尾）以上は同じ半径に丸め、ターミナル駅の円が地図を覆うのを防ぐ。
 */
function radiusStops(stops: number[], rMin: number, rMax: number): number[] {
  const top = stops[stops.length - 1]
  const out: number[] = []
  for (const v of stops) {
    out.push(v, Number((rMin + (rMax - rMin) * Math.sqrt(v / top)).toFixed(2)))
  }
  return out
}

/**
 * MapLibre は 1 つの式に zoom ベースの interpolate を 1 つしか許さないので、
 * ズーム補間を必ず最外側に置き、ホバー時の拡大は各ズームストップの内側で分岐させる。
 */
const ptRadius = (
  expr: ExpressionSpecification,
  stops: number[],
  hoverScale: number,
): ExpressionSpecification => {
  const at = (rMin: number, rMax: number, s: number): ExpressionSpecification =>
    ['interpolate', ['linear'], expr, ...radiusStops(stops, rMin * s, rMax * s)] as ExpressionSpecification
  const stop = (rMin: number, rMax: number): ExpressionSpecification =>
    ['case', isHovered, at(rMin, rMax, hoverScale), at(rMin, rMax, 1)] as ExpressionSpecification
  // 低ズームでは全国 9,400 駅ぶんの円が並ぶ。ここを大きくすると円の塊で
  // 線レイヤーが埋もれるので、広域では小さく、拡大に従って伸ばす。
  return ['interpolate', ['linear'], ['zoom'],
    6, stop(0.7, 2.2),
    9, stop(1.2, 4.2),
    11, stop(1.9, 6.6),
    13, stop(2.6, 10),
  ] as ExpressionSpecification
}

/**
 * 線幅も本数に連動させる（色＋太さの二重符号化）。
 * 色だけだと低ズームで幹線と支線の区別がつきにくい。
 * 色と同じ区切り（stops）に載せるので、凡例の目盛りが太さにも対応する。
 */
const WIDTH_FRACTIONS = [0, 0.24, 0.5, 0.74, 1]

const lineWidth = (stops: number[], hoverScale: number): ExpressionSpecification => {
  const at = (min: number, max: number, s: number): ExpressionSpecification => {
    const pairs: number[] = []
    stops.forEach((v, i) => pairs.push(v, (min + (max - min) * WIDTH_FRACTIONS[i]) * s))
    return ['interpolate', ['linear'], HONSU_TOTAL, ...pairs] as ExpressionSpecification
  }
  // ズーム補間は最外側に 1 つだけ（ptRadius と同じ制約）
  const stop = (min: number, max: number): ExpressionSpecification =>
    ['case', isHovered, at(min, max, hoverScale), at(min, max, 1)] as ExpressionSpecification
  return ['interpolate', ['linear'], ['zoom'],
    6, stop(0.9, 2.8),
    10, stop(1.7, 5.5),
    13, stop(2.6, 9),
  ] as ExpressionSpecification
}

type LayerStyle =
  | Pick<LineLayerSpecification, 'type' | 'paint' | 'layout'>
  | Pick<CircleLayerSpecification, 'type' | 'paint' | 'layout'>

export function paintFor(def: LayerDef, theme: Theme): LayerStyle {
  const strokeLight = 'rgba(255,255,255,0.85)'
  const strokeDark = 'rgba(0,0,0,0.55)'
  const stroke = theme === 'dark' ? strokeDark : strokeLight
  const canHover = Boolean(def.idProp)
  const stops = def.stops ?? []

  if (def.geom === 'line') {
    const color = colorExpr(def, HONSU_TOTAL, theme)
    return {
      type: 'line',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': sortKey(HONSU_TOTAL),
      },
      paint: {
        'line-width': lineWidth(stops, canHover ? 1.8 : 1),
        'line-color': canHover
          ? (['case', isHovered, HOVER_COLOR[theme], color] as ExpressionSpecification)
          : color,
        // 半透明だと重畳部分だけ色が濃くなり「本数が多い」と誤読されるため不透明にする
        'line-opacity': 1,
      },
    }
  }

  const expr = valueExpr(def)
  if (expr) {
    const color = colorExpr(def, expr, theme)
    return {
      type: 'circle',
      layout: { 'circle-sort-key': sortKey(expr) },
      paint: {
        'circle-radius': ptRadius(expr, stops, canHover ? 1.3 : 1),
        'circle-color': ['case', isHovered, HOVER_COLOR[theme], color],
        // 同座標に重なる円が同心円（大きい方が縁として残る）に見えるよう不透明＋縁取り
        'circle-opacity': 1,
        'circle-stroke-color': ['case', isHovered, HOVER_COLOR[theme], stroke],
        // 縁取りも低ズームでは細く。円が小さいうちは縁が面積の大半を占めてしまう
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'],
          6, ['case', isHovered, 2.2, 0.4],
          11, ['case', isHovered, 2.2, 0.9],
        ],
      },
    }
  }

  // kukan_eki: 本数も一意 ID も持たない → 位置のみの点（ハイライト無し）。
  // 明度に載せる値が無いので、種別の色相だけをランプ中位の 1 色で示す。
  const cat = categoryExpr(def)
  const solid: unknown[] = ['match', cat as ExpressionSpecification]
  for (const c of CATEGORIES) solid.push(c.key, rampColors(c.key, theme)[3])
  solid.push(PLAIN_COLOR[theme])
  return {
    type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 13, 4],
      'circle-color': (cat ? solid : PLAIN_COLOR[theme]) as ExpressionSpecification,
      'circle-stroke-color': stroke,
      'circle-stroke-width': 0.6,
    },
  }
}

/**
 * 種別フィルタ。`kukan` は区間内の全事業者を合算した値なので種別を持てず、
 * このフィルタの対象外になる（null を返す）。
 */
export function categoryFilter(def: LayerDef, enabled: Category[]): ExpressionSpecification | null {
  const cat = categoryExpr(def)
  if (!cat) return null
  return ['in', cat, ['literal', enabled]] as ExpressionSpecification
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
  // 地図の色相が何を指しているかをその場で確かめられるよう種別を添える
  const def = LAYERS.find((l) => l.key === key)
  const cat = def ? categoryOfProps(def, p) : null
  const tag = cat ? `<span class="tt-cat">${esc(categoryLabel(cat))}</span>` : ''
  if (key === 'kukan') {
    // 区間別: 同一区間を走る全路線・全事業者の列車を合算した本数
    return `<b>${g('路線名')} 区間</b> ｜ 全列車計 ${fmt(p['honsu_total'])}本/日`
  }
  if (key === 'rosen_kukan') {
    return `${tag}<b>${g('路線名')}</b> ｜ 計 ${fmt(p['honsu_total'])}本/日`
  }
  if (key === 'eki' || key === 'rosen_eki') {
    // 発着計 = 発本数 + 着本数（列車1本が発・着で2回計上されうる）
    return `${tag}<b>${g('駅名')}</b> ｜ 発着計 ${fmt(hassakuTotal(key, p))}本/日`
  }
  return `${tag}<b>${g('EkiName')}</b> ｜ ${g('RName')}`
}

export function popupHtml(key: string, p: Record<string, unknown>): string {
  const g = (k: string): string => esc(p[k])
  const def = LAYERS.find((l) => l.key === key)
  const cat = def ? categoryOfProps(def, p) : null
  // 種別は地図の色相と対応するので、値を読むときに必ず添える
  const catFoot = cat ? ` ｜ ${esc(categoryLabel(cat))}` : ''
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
      `</dl><div class="pp-foot">${countYear(p)}年版（平日）${isKukan ? '' : ` ｜ ${g('事業者名')}${catFoot}`}</div>`
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
      `<div class="pp-foot">${countYear(p)}年版${catFoot} ｜ 発着計＝発本数＋着本数（平日1日）</div>`
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
      `<div class="pp-foot">${countYear(p)}年版${catFoot} ｜ 発着計＝発本数＋着本数（平日1日）</div>`
    )
  }
  return (
    `<div class="pp-title">${g('EkiName')}</div>` +
    `<div class="pp-sub">${g('RName')} ｜ ${g('JName')}</div>` +
    `<div class="pp-foot">${countYear(p)}年版${catFoot} ｜ 区間端の駅（本数データなし）</div>`
  )
}
