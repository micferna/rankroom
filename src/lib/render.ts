import { RankRoomError } from './errors'
import type { Board, ItemId, ThemeName } from '~/types'
import { readableInk, tint } from './palette'

/**
 * One canvas renderer serves every export path: the PNG, the 16:9 thumbnail and
 * each frame of the replay video. Drawing the board ourselves — instead of
 * screenshotting the DOM — keeps output pixel-identical across browsers, avoids
 * a heavyweight html-to-image dependency, and is fast enough to run at 30 fps.
 */

export interface RenderTheme {
  bg: string
  edge: string
  ink: string
  muted: string
}

const THEMES: Record<ThemeName, RenderTheme> = {
  studio: {
    bg: '#0A0C10',
    edge: '#232C3B',
    ink: '#E9EFF8',
    muted: '#7E8CA3',
  },
  daylight: {
    bg: '#EDF1F7',
    edge: '#D2DAE6',
    ink: '#0D1420',
    muted: '#5C6879',
  },
}

export interface RenderOptions {
  /** Output width in device pixels. Every other measure derives from it. */
  width: number
  theme: ThemeName
  /** Draw the unranked bench under the tiers. */
  includeBench: boolean
  /** Tiles per row. Fewer means bigger tiles. */
  columns: number
  showLabels: boolean
  watermark: boolean
  /** Replaces the default credit line. Empty falls back to the RankRoom mark. */
  credit: string
  /** Small logo drawn beside the credit; a data URL, like a tile image. */
  logo?: CanvasImageSource
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  width: 1600,
  theme: 'studio',
  includeBench: false,
  columns: 10,
  showLabels: true,
  watermark: true,
  credit: '',
}

const DISPLAY_FONT = "'Archivo', system-ui, sans-serif"
const MONO_FONT = "'Martian Mono', ui-monospace, monospace"

/** Extra painting instructions layered on top of a plain board render. */
export interface PaintExtras {
  /** Tile to pop, and how hard (0 = flat, 1 = full pop). Used by the replay. */
  highlight?: { itemId: ItemId; emphasis: number }
}

interface Cell {
  itemId: ItemId
  x: number
  y: number
  size: number
}

interface Row {
  label: string
  color: string
  y: number
  height: number
  cells: Cell[]
}

interface Layout {
  width: number
  height: number
  headerHeight: number
  footerHeight: number
  rows: Row[]
  pad: number
  slugWidth: number
  tileSize: number
  gutter: number
}

function metrics(options: RenderOptions) {
  const pad = Math.round(options.width * 0.026)
  const gutter = Math.max(3, Math.round(options.width * 0.005))
  const slugWidth = Math.round(options.width * 0.1)
  const columns = Math.max(3, Math.min(20, options.columns))
  const usable = options.width - pad * 2 - slugWidth - gutter
  const tileSize = Math.floor(usable / columns) - gutter

  return { pad, gutter, slugWidth, columns, tileSize }
}

function layoutBoard(board: Board, options: RenderOptions): Layout {
  const { pad, gutter, slugWidth, columns, tileSize } = metrics(options)
  const headerHeight = Math.round(pad * 2 + options.width * 0.062)
  const footerHeight = options.watermark ? Math.round(options.width * 0.034) : pad

  const groups = board.tiers.map((tier) => ({
    label: tier.label,
    color: tier.color,
    itemIds: tier.itemIds,
  }))
  if (options.includeBench && board.bench.length > 0) {
    groups.push({ label: 'BENCH', color: THEMES[options.theme].edge, itemIds: board.bench })
  }

  const rows: Row[] = []
  let y = headerHeight

  for (const group of groups) {
    const lines = Math.max(1, Math.ceil(group.itemIds.length / columns))
    const height = lines * (tileSize + gutter) + gutter

    const cells = group.itemIds.map((itemId, index) => ({
      itemId,
      x: pad + slugWidth + gutter + (index % columns) * (tileSize + gutter),
      y: y + gutter + Math.floor(index / columns) * (tileSize + gutter),
      size: tileSize,
    }))

    rows.push({ label: group.label, color: group.color, y, height, cells })
    y += height + gutter
  }

  return {
    width: options.width,
    height: y + footerHeight,
    headerHeight,
    footerHeight,
    rows,
    pad,
    slugWidth,
    tileSize,
    gutter,
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Draws text clipped to `maxWidth`, ending in an ellipsis when it does not fit. */
function fittedText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value

  let text = value
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1)
  }
  return `${text}…`
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  cell: Cell,
  board: Board,
  images: ReadonlyMap<ItemId, CanvasImageSource>,
  options: RenderOptions,
  theme: RenderTheme,
  emphasis = 0,
): void {
  const item = board.items[cell.itemId]
  if (!item) return

  const radius = Math.max(3, cell.size * 0.07)

  ctx.save()
  if (emphasis > 0) {
    // Replay frames pop the tile that just landed, scaling it about its centre.
    const scale = 1 + emphasis * 0.3
    const cx = cell.x + cell.size / 2
    const cy = cell.y + cell.size / 2
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    ctx.translate(-cx, -cy)
    ctx.shadowColor = `rgb(255 255 255 / ${0.55 * emphasis})`
    ctx.shadowBlur = cell.size * 0.35 * emphasis
  }

  ctx.save()
  roundRect(ctx, cell.x, cell.y, cell.size, cell.size, radius)
  ctx.clip()

  const image = images.get(cell.itemId)
  if (image) {
    const iw = 'width' in image ? Number(image.width) : cell.size
    const ih = 'height' in image ? Number(image.height) : cell.size
    // Cover-crop so tiles stay square whatever the source aspect ratio is.
    const scale = Math.max(cell.size / iw, cell.size / ih)
    const dw = iw * scale
    const dh = ih * scale
    ctx.drawImage(image, cell.x + (cell.size - dw) / 2, cell.y + (cell.size - dh) / 2, dw, dh)
  } else {
    ctx.fillStyle = `hsl(${item.hue} 52% ${options.theme === 'studio' ? 26 : 74}%)`
    ctx.fillRect(cell.x, cell.y, cell.size, cell.size)

    ctx.fillStyle = options.theme === 'studio' ? '#F4F7FC' : '#0A0C10'
    ctx.font = `700 ${Math.round(cell.size * 0.34)}px ${DISPLAY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const initials = item.label.slice(0, 2).toUpperCase() || '?'
    ctx.fillText(initials, cell.x + cell.size / 2, cell.y + cell.size / 2)
  }

  if (options.showLabels && item.label) {
    const bandHeight = Math.round(cell.size * 0.26)
    const gradient = ctx.createLinearGradient(
      0,
      cell.y + cell.size - bandHeight * 1.6,
      0,
      cell.y + cell.size,
    )
    gradient.addColorStop(0, 'rgb(0 0 0 / 0)')
    gradient.addColorStop(1, 'rgb(0 0 0 / 0.82)')
    ctx.fillStyle = gradient
    ctx.fillRect(cell.x, cell.y + cell.size - bandHeight * 1.6, cell.size, bandHeight * 1.6)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = `600 ${Math.round(cell.size * 0.15)}px ${DISPLAY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(
      fittedText(ctx, item.label, cell.size * 0.88),
      cell.x + cell.size / 2,
      cell.y + cell.size - bandHeight * 0.36,
    )
  }

  ctx.restore()

  ctx.strokeStyle =
    emphasis > 0 ? `rgb(255 255 255 / ${0.15 + 0.75 * emphasis})` : tint(theme.ink, 0.08)
  ctx.lineWidth = emphasis > 0 ? 2 : 1
  roundRect(ctx, cell.x + 0.5, cell.y + 0.5, cell.size - 1, cell.size - 1, radius)
  ctx.stroke()
  ctx.restore()
}

function paint(
  ctx: CanvasRenderingContext2D,
  board: Board,
  layout: Layout,
  images: ReadonlyMap<ItemId, CanvasImageSource>,
  options: RenderOptions,
  extras: PaintExtras = {},
): void {
  const theme = THEMES[options.theme]

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, layout.width, layout.height)

  // Header: title, subtitle, and a colour-bar rule that echoes the tier ramp.
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.ink
  ctx.font = `800 ${Math.round(layout.width * 0.036)}px ${DISPLAY_FONT}`
  ctx.fillText(
    fittedText(ctx, board.title, layout.width - layout.pad * 2),
    layout.pad,
    Math.round(layout.headerHeight * 0.56),
  )

  if (board.subtitle) {
    ctx.fillStyle = theme.muted
    ctx.font = `500 ${Math.round(layout.width * 0.0135)}px ${DISPLAY_FONT}`
    ctx.fillText(
      fittedText(ctx, board.subtitle, layout.width - layout.pad * 2),
      layout.pad,
      Math.round(layout.headerHeight * 0.78),
    )
  }

  const ruleY = layout.headerHeight - layout.gutter * 2
  const ruleWidth = (layout.width - layout.pad * 2) / Math.max(1, board.tiers.length)
  board.tiers.forEach((tier, index) => {
    ctx.fillStyle = tier.color
    ctx.fillRect(
      layout.pad + index * ruleWidth,
      ruleY,
      ruleWidth,
      Math.max(2, layout.width * 0.0022),
    )
  })

  for (const row of layout.rows) {
    ctx.fillStyle = tint(theme.ink, options.theme === 'studio' ? 0.04 : 0.05)
    roundRect(
      ctx,
      layout.pad + layout.slugWidth + layout.gutter,
      row.y,
      layout.width - layout.pad * 2 - layout.slugWidth - layout.gutter,
      row.height,
      Math.max(4, layout.width * 0.005),
    )
    ctx.fill()

    ctx.fillStyle = row.color
    roundRect(
      ctx,
      layout.pad,
      row.y,
      layout.slugWidth,
      row.height,
      Math.max(4, layout.width * 0.005),
    )
    ctx.fill()

    ctx.fillStyle = readableInk(row.color)
    ctx.font = `800 ${Math.round(Math.min(row.height * 0.46, layout.slugWidth * 0.5))}px ${DISPLAY_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      fittedText(ctx, row.label, layout.slugWidth * 0.84),
      layout.pad + layout.slugWidth / 2,
      row.y + row.height / 2,
    )

    for (const cell of row.cells) {
      const emphasis = extras.highlight?.itemId === cell.itemId ? extras.highlight.emphasis : 0
      drawTile(ctx, cell, board, images, options, theme, emphasis)
    }
  }

  if (options.watermark) {
    // The creator's own name wins over ours: an export goes out under their
    // brand, not the tool's.
    const credit = options.credit.trim() || 'MADE IN RANKROOM'
    const baseline = layout.height - layout.footerHeight / 2
    let right = layout.width - layout.pad

    if (options.logo) {
      const size = Math.round(layout.footerHeight * 0.62)
      const source = options.logo as { width?: number; height?: number }
      const iw = source.width ?? size
      const ih = source.height ?? size
      const width = ih > 0 ? Math.round((iw / ih) * size) : size

      ctx.drawImage(options.logo, right - width, baseline - size / 2, width, size)
      right -= width + Math.round(layout.pad * 0.4)
    }

    ctx.fillStyle = theme.muted
    ctx.font = `500 ${Math.round(layout.width * 0.0105)}px ${MONO_FONT}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(fittedText(ctx, credit, layout.width * 0.5), right, baseline)
  }
}

/** Decodes every tile image once, so repeated frames cost nothing extra. */
export async function preloadImages(board: Board): Promise<Map<ItemId, CanvasImageSource>> {
  const entries = await Promise.all(
    Object.values(board.items).map(async (item): Promise<[ItemId, CanvasImageSource] | null> => {
      if (!item.image) return null
      try {
        const response = await fetch(item.image)
        const bitmap = await createImageBitmap(await response.blob())
        return [item.id, bitmap]
      } catch {
        // A tile that fails to decode simply falls back to its initials swatch.
        return null
      }
    }),
  )

  return new Map(entries.filter((entry): entry is [ItemId, CanvasImageSource] => entry !== null))
}

/** Pixel size the board will occupy, without drawing anything. */
export function measureBoard(
  board: Board,
  overrides: Partial<RenderOptions> = {},
): { width: number; height: number } {
  const layout = layoutBoard(board, { ...DEFAULT_RENDER_OPTIONS, ...overrides })
  return { width: layout.width, height: layout.height }
}

/**
 * Paints into an existing context. The replay loop calls this ~30 times a second,
 * so it must not allocate a canvas or decode an image.
 */
export function paintBoardTo(
  ctx: CanvasRenderingContext2D,
  board: Board,
  overrides: Partial<RenderOptions>,
  images: ReadonlyMap<ItemId, CanvasImageSource>,
  extras: PaintExtras = {},
): void {
  const options = { ...DEFAULT_RENDER_OPTIONS, ...overrides }
  paint(ctx, board, layoutBoard(board, options), images, options, extras)
}

export async function renderBoard(
  board: Board,
  overrides: Partial<RenderOptions> = {},
  images?: ReadonlyMap<ItemId, CanvasImageSource>,
): Promise<HTMLCanvasElement> {
  const options = { ...DEFAULT_RENDER_OPTIONS, ...overrides }
  const layout = layoutBoard(board, options)
  const resolved = images ?? (await preloadImages(board))

  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new RankRoomError('image.canvasBlocked')

  paint(ctx, board, layout, resolved, options)
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new RankRoomError('export.failed'))
    }, type)
  })
}

/**
 * 1280×720 title card built from the board's top tier — the frame a creator
 * actually needs when the video is uploaded, not a crop of the tier list.
 */
export async function renderThumbnail(
  board: Board,
  overrides: Partial<RenderOptions> = {},
): Promise<HTMLCanvasElement> {
  const options = { ...DEFAULT_RENDER_OPTIONS, ...overrides }
  const theme = THEMES[options.theme]
  const width = 1280
  const height = 720

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new RankRoomError('image.canvasBlocked')

  const images = await preloadImages(board)
  const top = board.tiers[0]
  const highlights = (top?.itemIds ?? board.bench).slice(0, 4)
  const accent = top?.color ?? '#E8D24B'

  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, width, height)

  // Colour bars bleed off the right edge, behind the highlighted tiles.
  board.tiers.forEach((tier, index) => {
    ctx.fillStyle = tint(tier.color, 0.14)
    ctx.fillRect(
      width - 520,
      (height / board.tiers.length) * index,
      520,
      height / board.tiers.length,
    )
  })

  const tileSize = 232
  const originX = width - 500
  const originY = height / 2 - tileSize - 12
  highlights.forEach((itemId, index) => {
    drawTile(
      ctx,
      {
        itemId,
        x: originX + (index % 2) * (tileSize + 18),
        y: originY + Math.floor(index / 2) * (tileSize + 18),
        size: tileSize,
      },
      board,
      images,
      { ...options, showLabels: false },
      theme,
    )
  })

  ctx.fillStyle = accent
  ctx.fillRect(72, 168, 96, 10)

  ctx.fillStyle = theme.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const words = board.title.toUpperCase().split(' ')
  const lines: string[] = []
  ctx.font = `800 74px ${DISPLAY_FONT}`
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > 620 && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)

  lines.slice(0, 3).forEach((text, index) => {
    ctx.fillText(text, 72, 214 + index * 84)
  })

  ctx.fillStyle = accent
  ctx.font = `500 20px ${MONO_FONT}`
  ctx.fillText(top ? `${top.label} TIER` : 'RANKED', 72, 130)

  ctx.fillStyle = theme.muted
  ctx.font = `500 18px ${MONO_FONT}`
  ctx.fillText(board.subtitle || options.credit.trim() || 'RANKROOM', 72, height - 96)

  return canvas
}
