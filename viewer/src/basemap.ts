import type { StyleSpecification } from 'maplibre-gl'
import paleStyle from './pale-style.json'
import type { Theme } from './theme'

// ---- 色ユーティリティ（明度反転でダーク化するため） ----

function parseColor(str: string): [number, number, number, number] | null {
  const s = str.trim()
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (rgba) {
    return [+rgba[1], +rgba[2], +rgba[3], rgba[4] !== undefined ? +rgba[4] : 1]
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return [r, g, b, a]
  }
  return null
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const hue = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)]
}

/**
 * 基図の彩度をここまで落とす。
 *
 * 地理院淡色は高速道路＝緑、国道＝黄/橙 と、データレイヤーの種別色と同じ色相空間を使う。
 * そのままだと「緑の線」が中小私鉄なのか高速道路なのか判別できない。
 * 基図から色相を取り上げてデータ専用にすることで、種別の色がどれだけ弱くても読めるようになる。
 * 0 にすると海と陸の区別まで失うので、わずかに色味を残す。
 */
const BASEMAP_SATURATION = 0.2

/**
 * 水域だけは彩度を多めに残す。ここの青は「道路の種別」のような凡例的な色ではなく
 * 陸と海を見分けるための色で、データレイヤーのどの種別色とも競合しない。
 * 全部グレーにすると日本地図として海岸線が読みにくくなる。
 */
const WATER_SATURATION = 0.55
const WATER_LAYER = /水|海|川|^background$/

/** 彩度だけ落とす（色相・明度は保持）。ライトテーマ用。 */
function muteColor(str: string, keep: number): string {
  const c = parseColor(str)
  if (!c) return str
  const [r, g, b, a] = c
  const [h, s, l] = rgbToHsl(r, g, b)
  const [nr, ng, nb] = hslToRgb(h, s * keep, l)
  return `rgba(${nr},${ng},${nb},${a})`
}

/** 明度を反転して暗色に変換（色相は保持、彩度は落とす）。ダークテーマ用。 */
function darkenColor(str: string, keep: number): string {
  const c = parseColor(str)
  if (!c) return str
  const [r, g, b, a] = c
  const [h, s, l] = rgbToHsl(r, g, b)
  const nl = Math.min(0.9, Math.max(0.05, 1 - l))
  const [nr, ng, nb] = hslToRgb(h, s * keep, nl)
  return `rgba(${nr},${ng},${nb},${a})`
}

/** paint 値（文字列 or 式配列）の中の色文字列だけを再帰的に変換する。 */
function transformValue(v: unknown, fn: (c: string) => string): unknown {
  if (typeof v === 'string') return parseColor(v) ? fn(v) : v
  if (Array.isArray(v)) return v.map((x) => transformValue(x, fn))
  return v
}

function buildStyle(theme: Theme): StyleSpecification {
  const base = theme === 'dark' ? darkenColor : muteColor
  const style = structuredClone(paleStyle) as StyleSpecification
  for (const layer of style.layers) {
    const paint = (layer as { paint?: Record<string, unknown> }).paint
    if (!paint) continue
    const keep = WATER_LAYER.test(layer.id) ? WATER_SATURATION : BASEMAP_SATURATION
    const fn = (c: string): string => base(c, keep)
    for (const key of Object.keys(paint)) {
      if (key.includes('color')) paint[key] = transformValue(paint[key], fn)
    }
  }
  return style
}

const styleCache: Record<Theme, StyleSpecification | null> = { light: null, dark: null }

/**
 * 毎回コピーを返す。map.setStyle() に渡したオブジェクトは MapLibre 側で
 * stylesheet として保持され、addLayer/addSource がそこへ書き込むので、
 * 同じオブジェクトを使い回すとテーマを往復するたびにデータレイヤーが混入する。
 */
export function getBasemapStyle(theme: Theme): StyleSpecification {
  if (!styleCache[theme]) styleCache[theme] = buildStyle(theme)
  return structuredClone(styleCache[theme] as StyleSpecification)
}
