import type { Board, ItemId, Move } from '~/types'
import { moveItem, resetPlacements } from './board'
import { RankRoomError } from './errors'
import {
  measureBoard,
  paintBoardTo,
  preloadImages,
  type GhostCell,
  type PaintExtras,
  type RenderOptions,
} from './render'

/**
 * A replay turns the session's move log back into video: every placement lands
 * again, in order, on a canvas. That canvas is captured with MediaRecorder, so
 * the export is a real WebM a creator can drop straight onto a timeline.
 */

/** The audience layer to reveal after the placements have finished. */
export interface CrowdReveal {
  /** Ghost cells per tier id, as `crowdGhosts` produces them. */
  ghosts: ReadonlyMap<string, readonly GhostCell[]>
  /** The item the crowd disagreed with hardest, ringed during the reveal. */
  spotlight: ItemId | null
}

export interface ReplayOptions {
  /** Milliseconds each placement is on screen. */
  stepMs: number
  /** 'wide' matches the PNG export; 'tall' letterboxes for Shorts and Reels. */
  format: 'wide' | 'tall'
  fps: number
  render: Partial<RenderOptions>
  /**
   * Appends a "here is what chat thought" ending. Nobody else can make this
   * clip, which is rather the point of putting it in the export.
   */
  crowd?: CrowdReveal
}

export const DEFAULT_REPLAY_OPTIONS: ReplayOptions = {
  stepMs: 420,
  format: 'wide',
  fps: 30,
  render: {},
}

/** Held on the finished board so the last frame is not a hard cut. */
const OUTRO_MS = 1200
/** Length of the crowd reveal that follows, when there is one. */
const CROWD_MS = 2600
/** How long the ghost layer takes to fade in at the start of that reveal. */
const CROWD_FADE_MS = 700

export interface ReplayTimeline {
  /**
   * `states[i]` is the board after `i` moves. Typed as a non-empty tuple because
   * `states[0]` — the board with nothing placed — always exists.
   */
  states: readonly [Board, ...Board[]]
  moves: readonly Move[]
  /** Where the placements end and the crowd reveal begins. */
  placementMs: number
  durationMs: number
  crowd?: CrowdReveal
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
  crowd?: CrowdReveal,
): ReplayTimeline {
  let current = resetPlacements(finalBoard)
  const states: [Board, ...Board[]] = [current]

  for (const move of moves) {
    current = moveItem(current, move.itemId, move.to, move.toIndex)
    states.push(current)
  }

  const placementMs = moves.length * stepMs + OUTRO_MS
  const hasCrowd = crowd !== undefined && crowd.ghosts.size > 0

  return {
    states,
    moves,
    placementMs,
    durationMs: placementMs + (hasCrowd ? CROWD_MS : 0),
    ...(hasCrowd ? { crowd } : {}),
  }
}

function easeOutBack(t: number): number {
  const c = 1.9
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

export interface ReplayFrame {
  board: Board
  extras: PaintExtras
}

/** The board and the layers to draw at `timeMs` into the replay. */
export function frameAt(timeline: ReplayTimeline, timeMs: number, stepMs: number): ReplayFrame {
  const final = timeline.states[timeline.states.length - 1] ?? timeline.states[0]

  // Past the placements, the crowd layer fades in over the finished board.
  if (timeline.crowd && timeMs >= timeline.placementMs) {
    const into = timeMs - timeline.placementMs
    const ghostOpacity = Math.min(1, into / CROWD_FADE_MS)

    return {
      board: final,
      extras: {
        ghosts: timeline.crowd.ghosts,
        ghostOpacity,
        // The callout waits until the layer is readable.
        ...(timeline.crowd.spotlight && ghostOpacity > 0.9
          ? { spotlight: timeline.crowd.spotlight }
          : {}),
      },
    }
  }

  const index = Math.min(timeline.moves.length, Math.max(0, Math.floor(timeMs / stepMs)))
  const board = timeline.states[index] ?? timeline.states[0]

  const move = timeline.moves[index - 1]
  if (!move) return { board, extras: {} }

  // The tile landed when *this* step began, so the decay is measured from
  // `index * stepMs`. Measuring from the previous step left `within` at 1 for
  // the whole window, which meant the pop never rendered at all.
  const within = Math.min(1, Math.max(0, (timeMs - index * stepMs) / stepMs))
  const emphasis = Math.max(0, 1 - easeOutBack(Math.min(1, within * 1.6)))

  return {
    board,
    extras: emphasis > 0.01 ? { highlight: { itemId: move.itemId, emphasis } } : {},
  }
}

interface Stage {
  canvas: HTMLCanvasElement
  /** Paints one frame, scaled and centred inside the output format. */
  draw: (frame: ReplayFrame, images: ReadonlyMap<ItemId, CanvasImageSource>) => void
}

function createStage(board: Board, options: ReplayOptions): Stage {
  const render: Partial<RenderOptions> = { width: 1440, watermark: true, ...options.render }
  // Measured with the ghosts in place: they take real cells, so a board that
  // grows during the crowd reveal must not overflow the frame it was scaled for.
  const natural = measureBoard(board, render, options.crowd ? { ghosts: options.crowd.ghosts } : {})

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
    paintBoardTo(ctx, frame.board, render, images, frame.extras)
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

  const timeline = buildTimeline(board, moves, options.stepMs, options.crowd)
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
