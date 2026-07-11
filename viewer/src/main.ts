import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'

import { getBasemapStyle } from './basemap'
import {
  LAYERS,
  type LayerDef,
  hoverHtml,
  paintFor,
  popupHtml,
  rampColors,
} from './layers'
import { applyThemeAttr, initialTheme, type Theme } from './theme'
import './style.css'

const PMTILES_BASE = import.meta.env.VITE_PMTILES_BASE ?? '/pmtiles'
const DATA_ATTRIBUTION =
  '鉄道運行本数 CC-BY 4.0 / ODbL（<a href="https://gtfs-gis.jp/railway_honsu/" target="_blank" rel="noopener">gtfs-gis.jp</a>）'
const YEARS = ['2023', '2024', '2025', '2026']

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
const activeLayerIds = (): string[] =>
  LAYERS.filter((l) => l.on).map((l) => layerId(l.key)).filter((id) => map.getLayer(id))

function addDataLayers(): void {
  for (const def of LAYERS) {
    if (map.getLayer(layerId(def.key))) map.removeLayer(layerId(def.key))
    if (map.getSource(def.key)) map.removeSource(def.key)
  }
  for (const def of LAYERS) {
    map.addSource(def.key, {
      type: 'vector',
      url: `pmtiles://${PMTILES_BASE}/unkohonsu${year}_${def.key}.pmtiles`,
    })
    const p = paintFor(def, theme)
    map.addLayer({
      id: layerId(def.key),
      type: p.type,
      source: def.key,
      'source-layer': def.key,
      layout: { visibility: def.on ? 'visible' : 'none' },
      paint: p.paint,
    } as maplibregl.LayerSpecification)
  }
}

function onceStyleReady(cb: () => void): void {
  if (map.isStyleLoaded()) {
    cb()
    return
  }
  const h = (): void => {
    if (map.isStyleLoaded()) {
      map.off('styledata', h)
      cb()
    }
  }
  map.on('styledata', h)
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
  map.setStyle(getBasemapStyle(theme))
  onceStyleReady(() => {
    addDataLayers()
    renderLegend()
    renderToggleDots()
  })
}
themeBtn.addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'))

// ---- パネル開閉 ----
const panel = document.getElementById('panel') as HTMLElement
const collapseBtn = document.getElementById('collapse-btn') as HTMLButtonElement
function renderCollapseBtn(): void {
  collapseBtn.textContent = panel.classList.contains('collapsed') ? '▾' : '▴'
}
collapseBtn.addEventListener('click', () => {
  panel.classList.toggle('collapsed')
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
      addDataLayers()
    })
    yearSeg.append(b)
  }
}

// ---- レイヤートグル ----
const layersDiv = document.getElementById('layers') as HTMLElement
const dotFor = (def: LayerDef): string => {
  if (def.key === 'kukan_eki') return theme === 'dark' ? '#9aa0a6' : '#5f6368'
  const { colors } = rampColors(def.geom, theme)
  return colors[colors.length - 2]
}
function buildToggles(): void {
  for (const def of LAYERS) {
    const label = document.createElement('label')
    label.className = 'toggle'
    label.dataset.key = def.key

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = def.on
    input.addEventListener('change', () => {
      def.on = input.checked
      const id = layerId(def.key)
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', def.on ? 'visible' : 'none')
    })

    const sw = document.createElement('span')
    sw.className = 'switch'
    const text = document.createElement('span')
    text.className = 't-label'
    text.textContent = def.label
    const dot = document.createElement('span')
    dot.className = 't-dot'
    dot.style.background = dotFor(def)

    label.append(input, sw, text, dot)
    layersDiv.append(label)
  }
}
function renderToggleDots(): void {
  for (const def of LAYERS) {
    const dot = layersDiv.querySelector<HTMLElement>(`.toggle[data-key="${def.key}"] .t-dot`)
    if (dot) dot.style.background = dotFor(def)
  }
}

// ---- 凡例 ----
const legendDiv = document.getElementById('legend') as HTMLElement
function legendBlock(title: string, geom: 'line' | 'point'): string {
  const { stops, colors } = rampColors(geom, theme)
  const max = stops[stops.length - 1]
  const gradient = colors
    .map((c, i) => `${c} ${Math.round((stops[i] / max) * 100)}%`)
    .join(', ')
  const ticks = stops
    .map((s, i) => `<span>${s}${i === stops.length - 1 ? '+' : ''}</span>`)
    .join('')
  return (
    `<div class="legend-block">` +
    `<div class="legend-title">${title}</div>` +
    `<div class="legend-bar" style="background:linear-gradient(90deg,${gradient})"></div>` +
    `<div class="legend-ticks">${ticks}</div>` +
    `</div>`
  )
}
function renderLegend(): void {
  legendDiv.innerHTML =
    legendBlock('線：運行本数（合計）', 'line') + legendBlock('点：発着本数', 'point')
}

// ---- ホバーツールチップ ----
const tooltip = document.getElementById('tooltip') as HTMLElement
map.on('mousemove', (e) => {
  const ids = activeLayerIds()
  const feats = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }) : []
  if (feats.length) {
    const f = feats[0]
    const key = keyFromLayer(f.layer.id)
    tooltip.innerHTML = hoverHtml(key, f.properties as Record<string, unknown>)
    tooltip.style.left = `${e.point.x}px`
    tooltip.style.top = `${e.point.y}px`
    tooltip.hidden = false
    map.getCanvas().style.cursor = 'pointer'
  } else {
    tooltip.hidden = true
    map.getCanvas().style.cursor = ''
  }
})
map.on('mouseout', () => {
  tooltip.hidden = true
})

// ---- クリックポップアップ ----
map.on('click', (e) => {
  const ids = activeLayerIds()
  const feats = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }) : []
  if (!feats.length) return
  const f = feats[0]
  const key = keyFromLayer(f.layer.id)
  new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
    .setLngLat(e.lngLat)
    .setHTML(popupHtml(key, f.properties as Record<string, unknown>))
    .addTo(map)
})

// ---- 初期化 ----
renderThemeBtn()
renderCollapseBtn()
buildYearSeg()
buildToggles()
renderLegend()
map.on('load', addDataLayers)
