import { describe, expect, it } from 'vitest'
import {
  BARS,
  colorAt,
  DEFAULT_PALETTE,
  isHexColor,
  paletteById,
  PALETTES,
  readableInk,
  relativeLuminance,
  tint,
} from './palette'

describe('the colour bars ramp', () => {
  it('descends in luminance, the way a test card is laid out', () => {
    const luminances = BARS.map(relativeLuminance)

    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]!).toBeLessThan(luminances[i - 1]!)
    }
  })
})

describe('readableInk', () => {
  it('keeps every shipped palette colour legible', () => {
    for (const palette of PALETTES) {
      for (const color of palette.colors) {
        const ink = readableInk(color)
        const contrast =
          (Math.max(relativeLuminance(color), relativeLuminance(ink)) + 0.05) /
          (Math.min(relativeLuminance(color), relativeLuminance(ink)) + 0.05)

        // 4.5:1 is the WCAG AA threshold for normal text.
        expect(contrast).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('colorAt', () => {
  it('cycles when there are more tiers than colours', () => {
    expect(colorAt(DEFAULT_PALETTE, BARS.length)).toBe(colorAt(DEFAULT_PALETTE, 0))
  })

  it('always returns a hex colour', () => {
    expect(isHexColor(colorAt({ id: 'x', name: 'x', note: '', colors: [] }, 0))).toBe(true)
  })
})

describe('paletteById', () => {
  it('falls back to the default for an unknown id', () => {
    expect(paletteById('nope')).toBe(DEFAULT_PALETTE)
  })
})

describe('tint', () => {
  it('produces a valid colour even for junk input', () => {
    expect(tint('not-a-colour', 0.5)).toMatch(/^rgb\(/)
    expect(tint('#E8D24B', 0.2)).toBe('rgb(232 210 75 / 0.2)')
  })
})
