import type { Board, ItemId, Move } from '~/types'
import { moveItem, resetPlacements } from './board'
import { RankRoomError } from './errors'
import { measureBoard, paintBoardTo, preloadImages, type RenderOptions } from './render'

/**
 * A replay turns the session's move log back into video: every placement lands
 * again, in order, on a canvas. That canvas is captured with MediaRecorder, so
 * the export is a real WebM a creator can drop straight onto a timeline.
 */

export interface ReplayOptions {
  /** Milliseconds each placement is on screen. */
  stepMs: number
  /** 'wide' matches the PNG export; 'tall' letterboxes for Shorts and Reels. */
  format: 'wide' | 'tall'
  fps: number
  render: Partial<RenderOptions>
}

export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  stepMs: 420,
  format: 'wide',
  fps: 30,
  render: {},
}

/** Held on the finished board so the last frame is not a hard cut. */
const OUTRO_MS = 1200

export interface ReplayTimeline {
  /**
   * `states[i]` is the board after `i` moves. Typed as a non-empty tuple because
   * `states[0]` — the board with nothing placed — always exists.
   */
  states: readonly [Board, ...Board[]]
  moves: readonly Move[]
  durationMs: number
}

/**
 * Rebuilds every intermediate board from the move log.
 *
 * Replaying forward from an empty board — rather than storing a snapshot per
 * move — keeps the log tiny and guarantees the replay matches the final board.
 */
export function buildTimeline(
  finalBoard: Board,
  moves: readonly Move[],
  stepMs: number,
): ReplayTimeline {
  let current = resetPlacements(finalBoard)
  const states: [Board, ...Board[]] = [current]

  for (const move of moves) {
    current = moveItem(current, move.itemId, move.to, move.toIndex)
    states.push(current)
  }

  return { states, moves, durationMs: moves.length * stepMs + OUTRO_MS }
}

function easeOutBack(t: number): number {
  const c = 1.9
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

export interface ReplayFrame {
  board: Board
  highlight: { itemId: ItemId; emphasis: number } | null
}

/** The board and pop intensity to draw at `timeMs` into the replay. */
export function frameAt(timeline: ReplayTimeline, timeMs: number, stepMs: number): ReplayFrame {
  const index = Math.min(timeline.moves.length, Math.max(0, Math.floor(timeMs / stepMs)))
  const board = timeline.states[index] ?? timeline.states[0]

  const move = timeline.moves[index - 1]
  if (!move) return { board, highlight: null }

  // The tile that landed at the start of this step decays back to flat.
  const within = Math.min(1, (timeMs - (index - 1) * stepMs) / stepMs)
  const emphasis = Math.max(0, 1 - easeOutBack(Math.min(1, within * 1.6)))

  return { board, highlight: emphasis > 0.01 ? { itemId: move.itemId, emphasis } : null }
}

interface Stage {
  canvas: HTMLCanvasElement
  /** Paints one frame, scaled and centred inside the output format. */
  draw: (frame: ReplayFrame, images: ReadonlyMap<ItemId, CanvasImageSource>) => void
}

function createStage(board: Board, options: ReplayOptions): Stage {
  const render: Partial<RenderOptions> = { width: 1440, watermark: true, ...options.render }
  const natural = measureBoard(board, render)

  const output =
    options.format === 'tall' ? { width: 1080, height: 1920 } : { width: 1600, height: 900 }

  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new RankRoomError('image.canvasBlocked')

  const scale = Math.min(
    (output.width * 0.94) / natural.width,
    (output.height * 0.9) / natural.height,
  )
  const offsetX = (output.width - natural.width * scale) / 2
  const offsetY = (output.height - natural.height * scale) / 2

  // The board is rendered once per frame at its natural size, then transformed
  // into place — so tile geometry never shifts between formats.
  const draw: Stage['draw'] = (frame, images) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = render.theme === 'daylight' ? '#EDF1F7' : '#0A0C10'
    ctx.fillRect(0, 0, output.width, output.height)
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY)
    paintBoardTo(
      ctx,
      frame.board,
      render,
      images,
      frame.highlight ? { highlight: frame.highlight } : {},
    )
  }

  return { canvas, draw }
}

/** Codecs in preference order; the first one this browser supports wins. */
const CODECS = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
] as const

export function supportsReplayExport(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    CODECS.some((type) => MediaRecorder.isTypeSupported(type))
  )
}

function pickCodec(): string {
  const supported = CODECS.find((type) => MediaRecorder.isTypeSupported(type))
  if (!supported) throw new RankRoomError('error.replay.codec')
  return supported
}

export interface ReplayRecording {
  blob: Blob
  /** File extension matching the codec the browser actually used. */
  extension: 'webm' | 'mp4'
}

/**
 * Records the replay in real time. MediaRecorder captures a live canvas stream,
 * so this takes as long as the replay itself — the caller shows progress.
 */
export async function recordReplay(
  board: Board,
  moves: readonly Move[],
  overrides: Partial<ReplayOptions> = {},
  onProgress?: (ratio: number) => void,
): Promise<ReplayRecording> {
  const options = { ...DEFAULT_REPLAY_OPTIONS, ...overrides }
  if (moves.length === 0) throw new RankRoomError('error.replay.empty')

  const timeline = buildTimeline(board, moves, options.stepMs)
  const images = await preloadImages(board)
  const stage = createStage(board, options)

  const mimeType = pickCodec()
  const stream = stage.canvas.captureStream(options.fps)
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('stop', () => {
      resolve(new Blob(chunks, { type: mimeType }))
    })
    recorder.addEventListener('error', () => {
      reject(new RankRoomError('error.replay.stopped'))
    })
  })

  recorder.start()
  const startedAt = performance.now()

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - startedAt
      stage.draw(frameAt(timeline, elapsed, options.stepMs), images)
      onProgress?.(Math.min(1, elapsed / timeline.durationMs))

      if (elapsed >= timeline.durationMs) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  recorder.stop()
  for (const track of stream.getTracks()) track.stop()

  return { blob: await finished, extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' }
}
