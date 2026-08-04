export interface Palette {
  id: string
  name: string
  note: string
  /** Ordered best tier first. Shorter than the tier list? Colours cycle. */
  colors: readonly string[]
}

/**
 * The default ramp is a broadcast test card: SMPTE colour bars are laid out by
 * descending luminance, which is exactly what a tier ladder needs. It stays
 * readable in greyscale, and it does not look like every other tier list.
 */
export const BARS = [
  '#D8DEE9', // white bar
  '#E8D24B', // yellow
  '#4FD3DE', // cyan
  '#4FCE7C', // green
  '#C267D6', // magenta
  '#E25353', // red
  '#5D7CE8', // blue
] as const

const COLOUR_BARS: Palette = {
  id: 'bars',
  name: 'Colour bars',
  note: 'SMPTE test card, ordered by luminance',
  colors: BARS,
}

export const PALETTES: readonly Palette[] = [
  COLOUR_BARS,
  {
    id: 'classic',
    name: 'Classic',
    note: 'The ladder everyone already knows',
    colors: ['#FF7F7F', '#FFBF7F', '#FFDF7F', '#FFFF7F', '#BFFF7F', '#7FFF7F', '#7FFFFF'],
  },
  {
    id: 'tungsten',
    name: 'Tungsten',
    note: 'Warm studio lighting, cool shadows',
    colors: ['#FFC24D', '#FF9B54', '#F2735F', '#C96480', '#8C5F9E', '#5C5C9E', '#3C4E80'],
  },
  {
    id: 'signal',
    name: 'Signal',
    note: 'Vectorscope greens through to blue crush',
    colors: ['#3BEFA0', '#3BD8C4', '#3BB8E0', '#5A93E8', '#7B72E0', '#A96FD6', '#6E4C9E'],
  },
  {
    id: 'grade',
    name: 'Greyscale',
    note: 'Let the items carry the colour',
    colors: ['#E6E9EF', '#C3C9D4', '#A0A8B7', '#7E879A', '#5D677C', '#414A5D', '#2B3342'],
  },
] as const

export const DEFAULT_PALETTE = COLOUR_BARS

export function paletteById(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? DEFAULT_PALETTE
}

/** Used only if a palette is somehow empty; every shipped palette has colours. */
const FALLBACK_COLOR = '#8A96A8'

/** Colour at `index`, cycling if the tier list is longer than the palette. */
export function colorAt(palette: Palette, index: number): string {
  return palette.colors[index % palette.colors.length] ?? FALLBACK_COLOR
}

export function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
}

function expandHex(hex: string): [number, number, number] {
  const body = hex.slice(1)
  const full =
    body.length === 3
      ? body
          .split('')
          .map((char) => char + char)
          .join('')
      : body

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0
  const [r, g, b] = expandHex(hex)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

const DARK_INK = '#0A0C10'
const LIGHT_INK = '#F4F7FC'

/** WCAG contrast ratio between two relative luminances, 1:1 to 21:1. */
export function contrastRatio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * Text colour for a tier label on an arbitrary swatch.
 *
 * Users can pick any colour, so this compares both inks and returns whichever
 * actually contrasts better — a fixed luminance threshold picks the wrong ink
 * for mid-tones, which is exactly where legibility is tightest.
 */
export function readableInk(background: string): string {
  const luminance = relativeLuminance(background)
  return contrastRatio(luminance, relativeLuminance(DARK_INK)) >=
    contrastRatio(luminance, relativeLuminance(LIGHT_INK))
    ? DARK_INK
    : LIGHT_INK
}

/** Same hue, dialled down — used for row backgrounds behind the tiles. */
export function tint(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return `rgb(255 255 255 / ${alpha})`
  const [r, g, b] = expandHex(hex)
  return `rgb(${r} ${g} ${b} / ${alpha})`
}
