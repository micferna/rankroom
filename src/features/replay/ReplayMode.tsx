import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { Segmented, Switch } from '~/components/ui/Field'
import { useT } from '~/i18n'
import { downloadBlob, slugify } from '~/lib/download'
import { errorKey } from '~/lib/errors'
import {
  buildTimeline,
  DEFAULT_REPLAY_OPTIONS,
  frameAt,
  recordReplay,
  supportsReplayExport,
} from '~/lib/replay'
import { crowdGhosts } from '~/lib/crowd'
import { measureBoard, paintBoardTo, preloadImages, type GhostCell } from '~/lib/render'
import { selectTally, useCrowdStore } from '~/store/crowdStore'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { ItemId } from '~/types'

const SPEEDS = [
  { value: '700', label: '0.6×' },
  { value: '420', label: '1×' },
  { value: '240', label: '1.7×' },
  { value: '120', label: '3.5×' },
] as const

/**
 * Plays the session back on a canvas and can record that canvas to a video file.
 * Preview and export share one renderer, so what plays here is what exports.
 */
export function ReplayMode() {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const moves = useBoardStore((state) => state.moves)
  const theme = useUiStore((state) => state.theme)
  const notify = useUiStore((state) => state.notify)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imagesRef = useRef<ReadonlyMap<ItemId, CanvasImageSource>>(new Map())
  const [stepMs, setStepMs] = useState(DEFAULT_REPLAY_OPTIONS.stepMs)
  const [format, setFormat] = useState<'wide' | 'tall'>('wide')
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [recording, setRecording] = useState<number | null>(null)
  const [withCrowd, setWithCrowd] = useState(true)

  const votes = useCrowdStore((state) => state.votes)
  const voteWindowMs = useCrowdStore((state) => state.config.windowMs)

  /**
   * The audience verdict, shaped for the renderer. Built here rather than in the
   * replay so the preview and the recording share exactly one source.
   */
  const crowd = useMemo(() => {
    if (votes.size === 0) return undefined

    const tally = selectTally(votes, board, voteWindowMs)
    const byTier = crowdGhosts(tally, board)
    if (byTier.size === 0) return undefined

    const ghosts = new Map<string, GhostCell[]>()
    let spotlight: string | null = null
    let widest = -1

    for (const [tierId, placements] of byTier) {
      ghosts.set(
        tierId,
        placements.map((placement) => ({
          itemId: placement.itemId,
          votes: placement.votes,
          share: placement.share,
        })),
      )

      // The hardest disagreement gets the callout: most votes wins ties.
      for (const placement of placements) {
        if (placement.votes > widest) {
          widest = placement.votes
          spotlight = placement.itemId
        }
      }
    }

    return { ghosts, spotlight }
  }, [votes, board, voteWindowMs])

  const reveal = withCrowd ? crowd : undefined

  const timeline = useMemo(
    () => buildTimeline(board, moves, stepMs, reveal),
    [board, moves, stepMs, reveal],
  )
  const renderOptions = useMemo(() => ({ width: 1280, theme, watermark: true }), [theme])
  // The board's height depends on how many rows wrap, so the canvas is measured
  // rather than assumed — otherwise the last tier would be cropped.
  const size = useMemo(
    () => measureBoard(board, renderOptions, reveal ? { ghosts: reveal.ghosts } : {}),
    [board, renderOptions, reveal],
  )

  const draw = useCallback(
    (timeMs: number) => {
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return

      const frame = frameAt(timeline, timeMs, stepMs)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      paintBoardTo(context, frame.board, renderOptions, imagesRef.current, frame.extras)
    },
    [timeline, stepMs, renderOptions],
  )

  useEffect(() => {
    let cancelled = false
    void preloadImages(board).then((images) => {
      if (cancelled) return
      imagesRef.current = images
      draw(position)
    })
    return () => {
      cancelled = true
    }
    // Images only change when the board's items do; position is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, draw])

  useEffect(() => {
    draw(position)
  }, [draw, position])

  useEffect(() => {
    if (!playing) return

    let frame = 0
    const startedAt = performance.now() - position

    const tick = () => {
      const elapsed = performance.now() - startedAt
      if (elapsed >= timeline.durationMs) {
        setPosition(timeline.durationMs)
        setPlaying(false)
        return
      }
      setPosition(elapsed)
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
    // Restarting on every position change would stutter; the loop owns position while playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline.durationMs])

  const exportVideo = async () => {
    setRecording(0)
    try {
      const result = await recordReplay(
        board,
        moves,
        { stepMs, format, render: renderOptions, ...(reveal ? { crowd: reveal } : {}) },
        (ratio) => {
          setRecording(ratio)
        },
      )
      downloadBlob(result.blob, `${slugify(board.title)}-replay.${result.extension}`)
      notify(t('replay.exported'), 'good')
    } catch (error) {
      notify(t(errorKey(error, 'replay.failed')), 'bad')
    } finally {
      setRecording(null)
    }
  }

  if (moves.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-10">
        <p className="slug">{t('replay.emptySlug')}</p>
        <h1 className="type-display mt-1.5 text-2xl">{t('replay.emptyTitle')}</h1>
        <p className="mt-3 max-w-[54ch] text-sm leading-relaxed text-slate">
          {t('replay.emptyBody')}
        </p>
      </div>
    )
  }

  const canExport = supportsReplayExport()

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-4 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          aria-label={t('replay.preview')}
          className="w-full rounded-panel border border-edge bg-room"
        />

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            icon={playing ? 'pause' : 'play'}
            onClick={() => {
              if (!playing && position >= timeline.durationMs) setPosition(0)
              setPlaying(!playing)
            }}
          >
            {playing ? t('replay.pause') : t('replay.play')}
          </Button>
          <Button
            variant="ghost"
            icon="rewind"
            onClick={() => {
              setPlaying(false)
              setPosition(0)
            }}
          >
            {t('replay.restart')}
          </Button>

          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="sr-only">{t('replay.position')}</span>
            <input
              type="range"
              min={0}
              max={timeline.durationMs}
              step={20}
              value={position}
              onChange={(event) => {
                setPlaying(false)
                setPosition(Number(event.target.value))
              }}
              className="w-full accent-preview"
            />
          </label>

          <span className="type-mono shrink-0 text-[11px] text-slate">
            {(position / 1000).toFixed(1)}s / {(timeline.durationMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
        <section className="panel p-3">
          <p className="slug mb-2">{t('replay.pace')}</p>
          <Segmented
            label={t('replay.speed')}
            value={String(stepMs)}
            options={SPEEDS.map((speed) => ({ value: speed.value, label: speed.label }))}
            onChange={(value) => {
              setPlaying(false)
              setStepMs(Number(value))
              setPosition(0)
            }}
          />

          <div className="mt-4">
            <p className="slug mb-2">{t('replay.frame')}</p>
            <Segmented
              label={t('replay.format')}
              value={format}
              options={[
                { value: 'wide', label: '16:9' },
                { value: 'tall', label: '9:16' },
              ]}
              onChange={setFormat}
            />
          </div>

          {crowd ? (
            <div className="mt-3 border-t border-edge pt-2">
              <Switch
                label={t('replay.withCrowd')}
                hint={t('replay.withCrowdHint')}
                checked={withCrowd}
                onChange={setWithCrowd}
              />
            </div>
          ) : null}

          <p className="mt-3 text-[11px] leading-relaxed text-slate">
            {t('replay.summary', {
              moves: moves.length,
              seconds: (timeline.durationMs / 1000).toFixed(1),
              size: format === 'wide' ? '1600×900' : '1080×1920',
            })}
          </p>
        </section>

        <section className="panel p-3">
          <p className="slug mb-2">{t('replay.export')}</p>
          {canExport ? (
            <>
              <Button
                variant="primary"
                icon="film"
                className="w-full"
                disabled={recording !== null}
                onClick={() => {
                  void exportVideo()
                }}
              >
                {recording === null
                  ? t('replay.record')
                  : t('replay.recording', { percent: Math.round(recording * 100) })}
              </Button>
              <p className="mt-2 text-[11px] leading-relaxed text-slate">
                {t('replay.recordHint', { seconds: (timeline.durationMs / 1000).toFixed(0) })}
              </p>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate">{t('replay.unsupported')}</p>
          )}
        </section>
      </aside>
    </div>
  )
}
