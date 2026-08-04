/**
 * Generates the app icons and the social card.
 *
 * Run with: npm run assets
 *
 * These are flat geometric compositions — colour bars, a tally dot, blocky
 * character-generator text — so they can be drawn pixel by pixel and encoded
 * with node:zlib. That avoids pulling a headless browser or an image library
 * into the toolchain for six static files, and it makes the artwork
 * reproducible: the source of truth is this file, not a binary someone exported.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public')
const MEDIA_DIR = join(ROOT, 'docs', 'media')

const ROOM = [0x0a, 0x0c, 0x10] as const
const BARS = [
  [0xd8, 0xde, 0xe9],
  [0xe8, 0xd2, 0x4b],
  [0x4f, 0xd3, 0xde],
  [0x4f, 0xce, 0x7c],
  [0xc2, 0x67, 0xd6],
  [0xe2, 0x53, 0x53],
  [0x5d, 0x7c, 0xe8],
] as const
const PROGRAM = [0xff, 0x2e, 0x38] as const
const CHALK = [0xe9, 0xef, 0xf8] as const

type Rgb = readonly [number, number, number]

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Drawing ---------------------------------------------------------------

class Surface {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.pixels = new Uint8Array(width * height * 4)
  }

  fill(color: Rgb, alpha = 255): void {
    this.rect(0, 0, this.width, this.height, color, alpha)
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb, alpha = 255): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py += 1) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px += 1) {
        this.set(px, py, color, alpha)
      }
    }
  }

  disc(cx: number, cy: number, radius: number, color: Rgb): void {
    for (let py = Math.max(0, cy - radius); py <= Math.min(this.height - 1, cy + radius); py += 1) {
      for (
        let px = Math.max(0, cx - radius);
        px <= Math.min(this.width - 1, cx + radius);
        px += 1
      ) {
        const distance = Math.hypot(px - cx + 0.5, py - cy + 0.5)
        // One pixel of coverage-based feathering keeps small icons from looking jagged.
        const coverage = Math.max(0, Math.min(1, radius - distance + 0.5))
        if (coverage > 0) this.set(px, py, color, Math.round(coverage * 255))
      }
    }
  }

  /** Clears everything outside a rounded rectangle, giving the icon its shape. */
  maskRoundedRect(radius: number): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const dx = Math.max(radius - x - 0.5, x + 0.5 - (this.width - radius), 0)
        const dy = Math.max(radius - y - 0.5, y + 0.5 - (this.height - radius), 0)
        const distance = Math.hypot(dx, dy)
        const coverage = Math.max(0, Math.min(1, radius - distance + 0.5))
        const index = (y * this.width + x) * 4
        this.pixels[index + 3] = Math.round((this.pixels[index + 3] ?? 0) * coverage)
      }
    }
  }

  private set(x: number, y: number, color: Rgb, alpha: number): void {
    const index = (y * this.width + x) * 4
    const a = alpha / 255
    const inverse = 1 - a
    const blend = (channel: number, offset: number) =>
      Math.round(channel * a + (this.pixels[index + offset] ?? 0) * inverse)

    this.pixels[index] = blend(color[0], 0)
    this.pixels[index + 1] = blend(color[1], 1)
    this.pixels[index + 2] = blend(color[2], 2)
    this.pixels[index + 3] = Math.max(this.pixels[index + 3] ?? 0, alpha)
  }
}

/**
 * 5×7 character generator, the same grid broadcast title tools used before
 * outline fonts. Only the glyphs the artwork needs are defined.
 */
const GLYPHS: Record<string, readonly string[]> = {
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
}

function drawText(
  surface: Surface,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb,
): void {
  let cursor = x
  for (const char of text) {
    const glyph = GLYPHS[char]
    if (!glyph) {
      cursor += scale * 4
      continue
    }
    glyph.forEach((row, ry) => {
      row.split('').forEach((bit, rx) => {
        if (bit === '1') surface.rect(cursor + rx * scale, y + ry * scale, scale, scale, color)
      })
    })
    cursor += scale * 6
  }
}

function write(name: string, surface: Surface): void {
  const file = join(OUT_DIR, name)
  writeFileSync(file, encodePng(surface.width, surface.height, surface.pixels))
  process.stdout.write(`${name}  ${surface.width}×${surface.height}\n`)
}

// --- Compositions ----------------------------------------------------------

/** App icon: colour bars behind a dark plate, with the tally lamp lit. */
function icon(size: number, maskable: boolean): Surface {
  const surface = new Surface(size, size)
  surface.fill(ROOM)

  const inset = maskable ? Math.round(size * 0.18) : Math.round(size * 0.13)
  const barWidth = (size - inset * 2) / BARS.length
  BARS.forEach((color, index) => {
    surface.rect(
      Math.round(inset + index * barWidth),
      inset,
      Math.ceil(barWidth),
      size - inset * 2,
      color,
    )
  })

  // The plate knocks the bars back so the lamp reads first.
  surface.rect(inset, Math.round(size * 0.56), size - inset * 2, Math.round(size * 0.26), ROOM, 235)
  surface.disc(Math.round(size * 0.5), Math.round(size * 0.69), Math.round(size * 0.082), PROGRAM)

  if (!maskable) surface.maskRoundedRect(Math.round(size * 0.22))
  return surface
}

/** Social card: a test pattern with the name set in the character generator. */
function socialCard(): Surface {
  const surface = new Surface(1200, 630)
  surface.fill(ROOM)

  const barWidth = 1200 / BARS.length
  BARS.forEach((color, index) => {
    surface.rect(Math.round(index * barWidth), 0, Math.ceil(barWidth), 168, color)
  })

  drawText(surface, 'RANKROOM', 96, 268, 20, CHALK)

  // Tally lamp and its bus, sitting on the baseline of the wordmark.
  surface.disc(110, 462, 14, PROGRAM)
  surface.rect(146, 455, 260, 6, PROGRAM, 190)

  // A narrow strip of bars closes the card, the way a test pattern is framed.
  BARS.forEach((color, index) => {
    surface.rect(Math.round(index * barWidth), 606, Math.ceil(barWidth), 24, color, 190)
  })
  return surface
}

/**
 * README wordmark. Drawn as rectangles rather than <text> so it renders
 * identically wherever the README is displayed, without depending on a font
 * being available — GitHub does not load webfonts inside an inline SVG.
 *
 * Two variants are emitted because an SVG loaded through <img> cannot inherit
 * `currentColor` from the host page: the README picks between them with
 * <picture> and a prefers-color-scheme media query.
 */
function wordmark(ink: string): string {
  const scale = 8
  const gap = 6
  const padX = 10
  const padY = 14
  const rects: string[] = []

  let cursor = padX
  for (const char of 'RANKROOM') {
    const glyph = GLYPHS[char]
    if (!glyph) continue
    glyph.forEach((row, ry) => {
      row.split('').forEach((bit, rx) => {
        if (bit === '1') {
          rects.push(
            `<rect x="${cursor + rx * scale}" y="${padY + ry * scale}" width="${scale}" height="${scale}"/>`,
          )
        }
      })
    })
    cursor += scale * 5 + gap
  }

  const width = cursor - gap + padX
  const barsY = padY + 7 * scale + 12
  const barWidth = (width - padX * 2) / BARS.length
  const bars = BARS.map(
    (color, index) =>
      `<rect x="${(padX + index * barWidth).toFixed(2)}" y="${barsY}" width="${barWidth.toFixed(2)}" height="8" fill="rgb(${color.join(' ')})"/>`,
  ).join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${barsY + 8 + padY}" width="${width}" role="img" aria-label="RankRoom">`,
    `<g fill="${ink}">${rects.join('')}</g>`,
    bars,
    '</svg>',
  ].join('')
}

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(MEDIA_DIR, { recursive: true })
write('icon-192.png', icon(192, false))
write('icon-512.png', icon(512, false))
write('icon-maskable-512.png', icon(512, true))
write('og.png', socialCard())

writeFileSync(join(MEDIA_DIR, 'wordmark-light.svg'), wordmark('#0A0C10'))
writeFileSync(join(MEDIA_DIR, 'wordmark-dark.svg'), wordmark('#E9EFF8'))
process.stdout.write('wordmark-light.svg + wordmark-dark.svg\n')
