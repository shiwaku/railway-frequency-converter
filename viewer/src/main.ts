import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'

import { getBasemapStyle } from './basemap'
import {
  CATEGORIES,
  type Category,
  LAYERS,
  type LayerDef,
  categoryFilter,
  hoverHtml,
  paintFor,
  popupHtml,
  rampColors,
  stopsFor,
} from './layers'
import { applyThemeAttr, initialTheme, type Theme } from './theme'
import './style.css'

const PMTILES_BASE = import.meta.env.VITE_PMTILES_BASE ?? '/pmtiles'
const DATA_ATTRIBUTION =
  '鉄道運行本数 CC-BY 4.0 / ODbL（<a href="https://gtfs-gis.jp/railway_honsu/" target="_blank" rel="noopener">gtfs-gis.jp</a>）'
const YEARS = ['2023', '2024', '2025', '2026']
const PANEL_KEY = 'railway-honsu-panel-collapsed'
/** ホバーが無い端末（タッチ）ではツールチップを出さず、タップのポップアップに一本化する。 */
const CAN_HOVER = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true
/** クリック/ホバーの判定に使う許容半径（px）。細い線と小さい点を掴みやすくする。 */
const HIT_PAD = CAN_HOVER ? 5 : 10

let theme: Theme = initialTheme()
let year = '2026'

applyThemeAttr(theme)

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

const map = new maplibregl.Map({
  container: 'map',
  style: getBasemapStyle(theme),
  center: [139.7, 35.68],
  zoom: 8,
  attributionControl: false,
})
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
map.addControl(new maplibregl.ScaleControl(), 'bottom-left')
map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: DATA_ATTRIBUTION }))

const layerId = (key: string): string => `${key}-lyr`
const keyFromLayer = (id: string): string => id.replace(/-lyr$/, '')
const defOf = (key: string): LayerDef | undefined => LAYERS.find((l) => l.key === key)
const activeLayerIds = (): string[] =>
  LAYERS.filter((l) => l.on).map((l) => layerId(l.key)).filter((id) => map.getLayer(id))
const sourceUrl = (key: string): string => `pmtiles://${PMTILES_BASE}/unkohonsu${year}_${key}.pmtiles`

// ---- ローディング表示 ----
const loadingEl = document.getElementById('loading') as HTMLElement
let loadingToken = 0
/**
 * 'idle' は再読込が始まる前のフレームでも発火しうるので、それだけを待つと
 * スピナーが一瞬で消える。最低待ち時間 + areTilesLoaded() で判定する。
 */
function beginLoading(): void {
  const token = ++loadingToken
  const started = performance.now()
  loadingEl.hidden = false
  const timer = window.setInterval(() => {
    if (token !== loadingToken) {
      window.clearInterval(timer)
      return
    }
    const elapsed = performance.now() - started
    if ((elapsed > 300 && map.areTilesLoaded()) || elapsed > 20000) {
      window.clearInterval(timer)
      loadingEl.hidden = true
    }
  }, 120)
}

function addDataLayers(): void {
  for (const def of LAYERS) {
    if (map.getLayer(layerId(def.key))) map.removeLayer(layerId(def.key))
    if (map.getSource(def.key)) map.removeSource(def.key)
  }
  for (const def of LAYERS) {
    map.addSource(def.key, {
      type: 'vector',
      url: sourceUrl(def.key),
      // tippecanoe はフィーチャ ID を振らないので、feature-state 用に
      // 一意プロパティ（ID）を昇格させる。持たないデータセットは省略。
      ...(def.idProp ? { promoteId: { [def.key]: def.idProp } } : {}),
    })
    const p = paintFor(def, theme)
    map.addLayer({
      id: layerId(def.key),
      type: p.type,
      source: def.key,
      'source-layer': def.key,
      // sort-key / line-cap は layout 側なので paintFor の layout を引き継ぐ
      layout: { ...(p.layout ?? {}), visibility: def.on ? 'visible' : 'none' },
      paint: p.paint,
    } as maplibregl.LayerSpecification)
  }
  applyCategoryFilters()
  beginLoading()
}

/**
 * 年次切替はソースの URL だけ差し替える。
 * レイヤーごと作り直すと一瞬すべて消えて画面がちらつくため。
 * setUrl を持たない実装にあたった場合だけ従来どおり作り直す。
 */
function updateYearSources(): void {
  clearHover()
  closePopup()
  let rebuilt = false
  for (const def of LAYERS) {
    const src = map.getSource(def.key) as (maplibregl.VectorTileSource & { setUrl?: (u: string) => void }) | undefined
    if (src && typeof src.setUrl === 'function') {
      src.setUrl(sourceUrl(def.key))
    } else {
      rebuilt = true
      break
    }
  }
  if (rebuilt) addDataLayers()
  else beginLoading()
}

// ---- テーマ ----
const themeBtn = document.getElementById('theme-btn') as HTMLButtonElement
function renderThemeBtn(): void {
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙'
}
function setTheme(next: Theme): void {
  theme = next
  applyThemeAttr(theme)
  renderThemeBtn()
  clearHover()
  // テーマ切替でデータレイヤーが消える問題への対処:
  //   - setStyle の既定（diff:true）は差分適用で、スタイルに無いデータレイヤーは削除される。
  //     しかも新しい Style を作らないので 'style.load' が発火せず、再追加の起点が取れない。
  //   - setStyle 直後の isStyleLoaded() は差し替え前のスタイルに対して true を返すため、
  //     それを見て再追加すると「消える前のスタイル」に足してしまう。
  // → diff:false で作り直し、'style.load' を待ってから再追加する。
  map.setStyle(getBasemapStyle(theme), { diff: false })
  map.once('style.load', () => {
    addDataLayers()
    renderLegend()
    renderCategoryChips()
  })
}
themeBtn.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'))

// ---- パネル開閉（状態を保存。モバイルは初期折りたたみ） ----
const panel = document.getElementById('panel') as HTMLElement
const collapseBtn = document.getElementById('collapse-btn') as HTMLButtonElement
function renderCollapseBtn(): void {
  const collapsed = panel.classList.contains('collapsed')
  collapseBtn.textContent = collapsed ? '▾' : '▴'
  collapseBtn.setAttribute('aria-expanded', String(!collapsed))
}
function initCollapsed(): void {
  const saved = localStorage.getItem(PANEL_KEY)
  const collapsed = saved === null ? window.innerWidth <= 640 : saved === '1'
  panel.classList.toggle('collapsed', collapsed)
}
collapseBtn.addEventListener('click', () => {
  const collapsed = panel.classList.toggle('collapsed')
  localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0')
  renderCollapseBtn()
})

// ---- 年次セグメント ----
const yearSeg = document.getElementById('year-seg') as HTMLElement
function buildYearSeg(): void {
  for (const y of YEARS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = y
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(y === year))
    b.addEventListener('click', () => {
      if (y === year) return
      year = y
      for (const el of yearSeg.children) el.setAttribute('aria-selected', String(el === b))
      updateYearSources()
    })
    yearSeg.append(b)
  }
}

// ---- レイヤートグル（線＝排他ラジオ / 点＝チェックボックス） ----
const layersDiv = document.getElementById('layers') as HTMLElement
function setLayerVisible(def: LayerDef, on: boolean): void {
  def.on = on
  const id = layerId(def.key)
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  if (!on && hovered?.source === def.key) clearHover()
}

function toggleRow(def: LayerDef | null, kind: 'radio' | 'checkbox', name?: string): HTMLLabelElement {
  const label = document.createElement('label')
  label.className = 'toggle'
  if (def) label.dataset.key = def.key

  const input = document.createElement('input')
  input.type = kind
  if (name) input.name = name
  input.checked = def ? def.on : LAYERS.filter((l) => l.exclusive === 'line').every((l) => !l.on)

  const mark = document.createElement('span')
  mark.className = kind === 'radio' ? 'radio' : 'switch'
  const text = document.createElement('span')
  text.className = 't-label'
  text.textContent = def ? def.label : '非表示'

  // 色は種別（下の「事業者種別」）が持つので、レイヤー行には色見本を置かない。
  // 全データセットで同じ色になり、情報を持たないドットは目印にならない。
  label.append(input, mark, text)

  input.addEventListener('change', () => {
    if (kind === 'radio') {
      // 排他グループ: 選ばれた 1 つだけを表示する
      for (const l of LAYERS) {
        if (l.exclusive === 'line') setLayerVisible(l, l === def)
      }
    } else if (def) {
      setLayerVisible(def, input.checked)
    }
    renderLegend()
    renderCategoryNote()
  })
  return label
}

function buildToggles(): void {
  const group = (title: string, hint: string, rows: HTMLElement[]): HTMLElement => {
    const wrap = document.createElement('div')
    wrap.className = 'tg-group'
    const head = document.createElement('div')
    head.className = 'tg-head'
    head.innerHTML = `${title}<span class="tg-hint">${hint}</span>`
    const list = document.createElement('div')
    list.className = 'toggles'
    list.append(...rows)
    wrap.append(head, list)
    return wrap
  }

  // 線: rosen_kukan と kukan は同じ線形に重なって描かれ、混ぜても読めないので排他にする
  const lineRows = LAYERS.filter((l) => l.exclusive === 'line').map((l) => toggleRow(l, 'radio', 'line-layer'))
  lineRows.push(toggleRow(null, 'radio', 'line-layer'))
  const pointRows = LAYERS.filter((l) => l.geom === 'point').map((l) => toggleRow(l, 'checkbox'))

  layersDiv.append(
    group('線', '区間の運行本数（排他）', lineRows),
    group('点', '駅の発着本数', pointRows),
  )
}

// ---- 事業者種別フィルタ ----
// 5 種別は色相で見分けるが、色相だけの区別は重なった路線や小さい円では読み取りにくく、
// 色覚特性によっては赤(路面電車)と緑(中小私鉄)が近づく。ここで種別を絞り込めることが
// その実務的な回避手段になる。
const catsDiv = document.getElementById('categories') as HTMLElement
const catNote = document.getElementById('cat-note') as HTMLElement
const enabledCats = new Set<Category>(CATEGORIES.map((c) => c.key))

/** 種別チップはその種別のランプをそのまま縮めたもの。色相＝種別、明度＝本数 が一目で分かる。 */
const catChipStyle = (c: Category): string =>
  `background:linear-gradient(90deg,${rampColors(c, theme).join(',')})`

function buildCategories(): void {
  for (const c of CATEGORIES) {
    const label = document.createElement('label')
    label.className = 'toggle'
    label.dataset.cat = c.key

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    const mark = document.createElement('span')
    mark.className = 'switch'
    const text = document.createElement('span')
    text.className = 't-label'
    text.textContent = c.label
    const chip = document.createElement('span')
    chip.className = 't-chip'
    chip.setAttribute('style', catChipStyle(c.key))

    label.append(input, mark, text, chip)
    input.addEventListener('change', () => {
      if (input.checked) enabledCats.add(c.key)
      else enabledCats.delete(c.key)
      applyCategoryFilters()
    })
    catsDiv.append(label)
  }
}

function renderCategoryChips(): void {
  for (const c of CATEGORIES) {
    const chip = catsDiv.querySelector<HTMLElement>(`.toggle[data-cat="${c.key}"] .t-chip`)
    if (chip) chip.setAttribute('style', catChipStyle(c.key))
  }
}

/** レイヤーを作り直すたび（年次・テーマ）に呼ぶ必要がある。 */
function applyCategoryFilters(): void {
  const enabled = [...enabledCats]
  for (const def of LAYERS) {
    const id = layerId(def.key)
    if (!map.getLayer(id)) continue
    const f = categoryFilter(def, enabled)
    if (f) map.setFilter(id, f)
  }
  renderCategoryNote()
  clearHover()
}

/** 種別を持てないレイヤーが表示中なら、フィルタが効かないことを明示する。 */
function renderCategoryNote(): void {
  const unsplit = LAYERS.filter((l) => l.on && !l.opProp)
  if (!unsplit.length) {
    catNote.hidden = true
    return
  }
  catNote.hidden = false
  catNote.textContent =
    `${unsplit.map((l) => l.label).join('・')}は区間内の全事業者を合算した値のため、種別で分けられません。`
}

// ---- 凡例（表示中のレイヤーに連動） ----
const legendDiv = document.getElementById('legend') as HTMLElement

/**
 * 目盛りは stops の実値位置に置く。等間隔に並べるとバーの色の切れ目とずれ、
 * 分位ベースの区切り（左に密）では読み手を確実に誤らせる。
 */
function legendTicks(stops: number[]): string {
  const top = stops[stops.length - 1]
  return stops
    .map((s, i) => {
      const last = i === stops.length - 1
      const pos =
        i === 0
          ? 'left:0'
          : last
            ? 'right:0'
            : `left:${((s / top) * 100).toFixed(1)}%;transform:translateX(-50%)`
      return `<span style="${pos}">${s}${last ? '+' : ''}</span>`
    })
    .join('')
}

function legendBlock(def: LayerDef): string {
  const stops = stopsFor(def)
  // 数値スケールは無彩色 1 本で示す。OKLCH で L・C を全種別共通に固定しているので
  // 「明度→本数」の対応は種別が変わっても同一で、色相ごとにバーを並べる必要がない。
  const colors = rampColors(null, theme)
  const top = stops[stops.length - 1]
  const gradient = colors
    .map((c, i) => `${c} ${((stops[i] / top) * 100).toFixed(1)}%`)
    .join(', ')
  const isLine = def.geom === 'line'
  const title = `${isLine ? '線' : '点'}：${def.label}`
  const canSplit = Boolean(def.opProp)
  const encode = canSplit ? '明度が本数・色相が種別' : '明度が本数（種別なし）'
  const note = isLine
    ? `運行本数 本/日 ｜ ${encode}・太さも連動 ｜ 多い区間を下に描画`
    : `発着計 本/日 ｜ ${encode}・円の面積も比例 ｜ 大きい円を下に描画`
  return (
    `<div class="legend-block">` +
    `<div class="legend-title">${title}</div>` +
    `<div class="legend-bar" style="background:linear-gradient(90deg,${gradient})"></div>` +
    `<div class="legend-ticks">${legendTicks(stops)}</div>` +
    `<div class="legend-note">${note}</div>` +
    `</div>`
  )
}

function renderLegend(): void {
  // 区切りはデータセットごとに違う（分布のレンジが 2〜4 倍違う）ので
  // 表示中のデータセットぶんだけ凡例を出す。
  const blocks = LAYERS.filter((l) => l.on && l.stops).map(legendBlock)
  // kukan_eki は本数を持たないので明度に載せる値が無い。色相＝種別だけを示す。
  if (defOf('kukan_eki')?.on) {
    blocks.push(
      `<div class="legend-block"><div class="legend-title">点：区間端の駅</div>` +
        `<div class="legend-note">本数データを持たない位置のみの点 ｜ 色相が種別（明度は本数と無関係）</div></div>`,
    )
  }
  legendDiv.innerHTML =
    blocks.join('') || `<div class="legend-note">表示中のデータレイヤーがありません</div>`
}

// ---- フィーチャ取得（クリック/ホバー共通） ----
type Feat = maplibregl.MapGeoJSONFeature

/** 同じフィーチャがタイル境界で重複して返ることがあるので畳む。 */
function dedupe(feats: Feat[]): Feat[] {
  const seen = new Set<string>()
  return feats.filter((f) => {
    const key = `${f.layer.id}:${f.id ?? JSON.stringify(f.properties)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function queryAt(pt: maplibregl.Point): Feat[] {
  const ids = activeLayerIds()
  if (!ids.length) return []
  // 細い線・小さい点を掴めるようにカーソル周辺の矩形で問い合わせる
  const box: [maplibregl.PointLike, maplibregl.PointLike] = [
    [pt.x - HIT_PAD, pt.y - HIT_PAD],
    [pt.x + HIT_PAD, pt.y + HIT_PAD],
  ]
  return dedupe(map.queryRenderedFeatures(box, { layers: ids }))
}

// ---- ホバーハイライト（feature-state） ----
let hovered: { source: string; sourceLayer: string; id: string | number } | null = null

function clearHover(): void {
  if (hovered && map.getSource(hovered.source)) map.setFeatureState(hovered, { hover: false })
  hovered = null
}

function setHover(f: Feat | null): void {
  const key = f ? keyFromLayer(f.layer.id) : null
  // ID を持たないデータセット（kukan_eki）は feature-state を張れない
  const id = f && defOf(key as string)?.idProp ? f.id : undefined
  if (id === undefined || id === null || key === null) {
    clearHover()
    return
  }
  if (hovered && hovered.source === key && hovered.id === id) return
  clearHover()
  hovered = { source: key, sourceLayer: key, id }
  map.setFeatureState(hovered, { hover: true })
}

// ---- ホバーツールチップ（rAF で間引き、画面端で折り返す） ----
const tooltip = document.getElementById('tooltip') as HTMLElement
let pendingPoint: maplibregl.Point | null = null
let rafId = 0

function placeTooltip(pt: maplibregl.Point): void {
  const canvas = map.getCanvas()
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  const box = tooltip.getBoundingClientRect()
  const halfW = box.width / 2
  // 左右: 画面内に収める。上下: 上に入らなければカーソル下に出す。
  const x = Math.min(Math.max(pt.x, halfW + 8), Math.max(halfW + 8, w - halfW - 8))
  const below = pt.y - box.height - 16 < 0
  tooltip.classList.toggle('below', below)
  const y = below ? Math.min(pt.y, h - box.height - 20) : pt.y
  tooltip.style.left = `${x}px`
  tooltip.style.top = `${y}px`
}

function hideTooltip(): void {
  tooltip.hidden = true
  tooltip.classList.remove('below')
}

function flushHover(): void {
  rafId = 0
  const pt = pendingPoint
  pendingPoint = null
  if (!pt) return
  const feats = queryAt(pt)
  if (feats.length) {
    const f = feats[0]
    setHover(f)
    map.getCanvas().style.cursor = 'pointer'
    tooltip.innerHTML = hoverHtml(keyFromLayer(f.layer.id), f.properties as Record<string, unknown>)
    tooltip.hidden = false
    placeTooltip(pt)
  } else {
    setHover(null)
    hideTooltip()
    map.getCanvas().style.cursor = ''
  }
}

if (CAN_HOVER) {
  map.on('mousemove', (e) => {
    // mousemove ごとに queryRenderedFeatures すると重いので 1 フレーム 1 回に間引く
    pendingPoint = e.point
    if (!rafId) rafId = requestAnimationFrame(flushHover)
  })
  map.on('mouseout', () => {
    pendingPoint = null
    setHover(null)
    hideTooltip()
  })
  map.on('dragstart', hideTooltip)
}

// ---- クリックポップアップ（重なったフィーチャを切り替えられる） ----
// 単一インスタンスを使い回す。毎回 new すると前のポップアップが残り複数表示になる。
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' })
let popupFeats: Feat[] = []
let popupIdx = 0

function closePopup(): void {
  popupFeats = []
  popupIdx = 0
  popup.remove()
}

function renderPopup(): void {
  const f = popupFeats[popupIdx]
  if (!f) return
  const key = keyFromLayer(f.layer.id)
  const props = f.properties as Record<string, unknown>
  const nav =
    popupFeats.length > 1
      ? `<div class="pp-nav">` +
        `<button type="button" class="pp-nav-btn" data-nav="prev" aria-label="前のフィーチャ">‹</button>` +
        `<span class="pp-nav-count">${popupIdx + 1} / ${popupFeats.length}<span class="pp-nav-kind">${defOf(key)?.label ?? key}</span></span>` +
        `<button type="button" class="pp-nav-btn" data-nav="next" aria-label="次のフィーチャ">›</button>` +
        `</div>`
      : ''
  popup.setHTML(nav + popupHtml(key, props))

  const el = popup.getElement()
  for (const btn of el?.querySelectorAll<HTMLButtonElement>('[data-nav]') ?? []) {
    btn.addEventListener('click', () => {
      const step = btn.dataset.nav === 'next' ? 1 : -1
      popupIdx = (popupIdx + step + popupFeats.length) % popupFeats.length
      renderPopup()
    })
  }
}

map.on('click', (e) => {
  const feats = queryAt(e.point)
  if (!feats.length) {
    closePopup()
    return
  }
  popupFeats = feats
  popupIdx = 0
  popup.setLngLat(e.lngLat).addTo(map)
  renderPopup()
  // タッチ端末はホバーが無いので、タップ時に何を選んだかを地図側でも示す
  if (!CAN_HOVER) setHover(feats[0])
})
popup.on('close', () => {
  popupFeats = []
  if (!CAN_HOVER) clearHover()
})
map.on('touchstart', hideTooltip)

// ---- 初期化 ----
renderThemeBtn()
initCollapsed()
renderCollapseBtn()
buildYearSeg()
buildToggles()
buildCategories()
renderCategoryNote()
renderLegend()
map.on('load', addDataLayers)
