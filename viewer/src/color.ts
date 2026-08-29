/**
 * OKLCH → sRGB。
 *
 * このビューアは「種別＝色相 / 運行本数＝明度」の二重符号化をする。
 * HSL の lightness は知覚的な明るさではなく、同じ L でも黄は青よりずっと明るく見える。
 * それだと種別によって同じ本数が違う明るさに見え、明度チャンネルが嘘になるので、
 * 知覚的に均等な OKLCH で L・C を全種別共通に固定し、H だけを種別に割り当てる。
 *
 * 変換は Björn Ottosson の Oklab 定義そのまま（OKLCH → Oklab → 線形 sRGB → sRGB）。
 */

type RGB = [number, number, number]

function oklabToLinearSrgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** 線形 sRGB → ガンマ補正済み sRGB（0–1）。 */
function encodeGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

const inGamut = (rgb: RGB): boolean => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4)

/**
 * 彩度を二分探索で落として sRGB の色域に収める。
 * 単に切り詰めると色相がずれて種別の見分けが壊れるので、C だけを縮める。
 */
function clampChroma(L: number, C: number, H: number): RGB {
  const at = (c: number): RGB => {
    const rad = (H * Math.PI) / 180
    return oklabToLinearSrgb(L, c * Math.cos(rad), c * Math.sin(rad))
  }
  if (inGamut(at(C))) return at(C)
  let lo = 0
  let hi = C
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(at(mid))) lo = mid
    else hi = mid
  }
  return at(lo)
}

const hex2 = (v: number): string =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, '0')

/** OKLCH を `#rrggbb` にする。L は 0–1、C は 0–0.4 程度、H は度。 */
export function oklch(L: number, C: number, H: number): string {
  const [r, g, b] = clampChroma(L, C, H).map(encodeGamma) as RGB
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}
