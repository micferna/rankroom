import { useEffect, useMemo, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { Segmented, Slider, Switch } from '~/components/ui/Field'
import { Modal } from '~/components/ui/Modal'
import { useT } from '~/i18n'
import { boardFileName, boardToArchive } from '~/lib/boardFile'
import { downloadBlob, downloadText, slugify } from '~/lib/download'
import { errorKey } from '~/lib/errors'
import { canvasToBlob, renderBoard, renderThumbnail, type RenderOptions } from '~/lib/render'
import { serializeBoard } from '~/lib/schema'
import type { MessageKey } from '~/i18n/en'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

const WIDTHS = [
  { value: '1200', label: 'export.width.web' },
  { value: '1600', label: 'export.width.hd' },
  { value: '2400', label: 'export.width.print' },
] as const satisfies readonly { value: string; label: MessageKey }[]

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const theme = useUiStore((state) => state.theme)
  const notify = useUiStore((state) => state.notify)

  const [options, setOptions] = useState<RenderOptions>(() => ({
    width: 1600,
    theme,
    includeBench: false,
    columns: 10,
    showLabels: true,
    watermark: true,
  }))
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const patch = (next: Partial<RenderOptions>) => {
    setOptions((current) => ({ ...current, ...next }))
  }

  // Previews render at a fraction of the export width: the layout is identical,
  // so a small render is an accurate proof without the encoding cost.
  const previewOptions = useMemo<Partial<RenderOptions>>(
    () => ({ ...options, width: 720 }),
    [options],
  )

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let url: string | null = null

    const timer = window.setTimeout(() => {
      void renderBoard(board, previewOptions)
        .then((canvas) => canvasToBlob(canvas))
        .then((blob) => {
          if (cancelled) return
          url = URL.createObjectURL(blob)
          setPreview(url)
        })
        .catch(() => {
          if (!cancelled) setPreview(null)
        })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
  }, [open, board, previewOptions])

  const exportImage = async (kind: 'board' | 'thumbnail') => {
    setBusy(true)
    try {
      const canvas =
        kind === 'board' ? await renderBoard(board, options) : await renderThumbnail(board, options)
      const blob = await canvasToBlob(canvas)
      downloadBlob(
        blob,
        `${slugify(board.title)}-${kind === 'board' ? 'tierlist' : 'thumbnail'}.png`,
      )
      notify(t('export.saved'), 'good')
    } catch (error) {
      notify(t(errorKey(error, 'export.failed')), 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('export.title')}
      hint={t('export.hint')}
      footer={
        <>
          <Button
            icon="download"
            title={t('file.archiveHint')}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void boardToArchive(board)
                .then((blob) => {
                  downloadBlob(blob, boardFileName(board, 'rankroom'))
                  notify(t('file.archiveSaved'), 'good')
                })
                .catch((error: unknown) => {
                  notify(t(errorKey(error, 'export.failed')), 'bad')
                })
                .finally(() => {
                  setBusy(false)
                })
            }}
          >
            {t('file.saveArchive')}
          </Button>
          <Button
            icon="download"
            onClick={() => {
              downloadText(
                JSON.stringify(serializeBoard(board), null, 2),
                `${slugify(board.title)}.json`,
              )
              notify(t('export.jsonSaved'), 'good')
            }}
          >
            {t('export.json')}
          </Button>
          <Button
            icon="image"
            disabled={busy}
            onClick={() => {
              void exportImage('thumbnail')
            }}
          >
            {t('export.thumbnail')}
          </Button>
          <Button
            variant="primary"
            icon="download"
            disabled={busy}
            onClick={() => {
              void exportImage('board')
            }}
          >
            {t('export.png')}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_15rem]">
        <div className="min-w-0">
          <p className="slug mb-2">{t('export.preview')}</p>
          {preview ? (
            <img
              src={preview}
              alt={t('export.previewAlt')}
              className="w-full rounded-control border border-edge"
            />
          ) : (
            <div className="grid h-48 place-items-center rounded-control border border-edge text-xs text-slate">
              {t('export.rendering')}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="slug mb-2">{t('export.size')}</p>
            <Segmented
              label={t('export.width')}
              value={String(options.width)}
              options={WIDTHS.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
              onChange={(value) => {
                patch({ width: Number(value) })
              }}
            />
          </div>

          <div>
            <p className="slug mb-2">{t('export.theme')}</p>
            <Segmented
              label={t('export.themeLabel')}
              value={options.theme}
              options={[
                { value: 'studio', label: t('export.theme.studio') },
                { value: 'daylight', label: t('export.theme.daylight') },
              ]}
              onChange={(value) => {
                patch({ theme: value })
              }}
            />
          </div>

          <Slider
            label={t('export.columns')}
            min={4}
            max={16}
            value={options.columns}
            onChange={(columns) => {
              patch({ columns })
            }}
            readout={t('export.columnsReadout', { count: options.columns })}
          />

          <div className="border-t border-edge pt-2">
            <Switch
              label={t('export.showLabels')}
              checked={options.showLabels}
              onChange={(showLabels) => {
                patch({ showLabels })
              }}
            />
            <Switch
              label={t('export.includeBench')}
              hint={t('export.includeBenchHint')}
              checked={options.includeBench}
              onChange={(includeBench) => {
                patch({ includeBench })
              }}
            />
            <Switch
              label={t('export.watermark')}
              checked={options.watermark}
              onChange={(watermark) => {
                patch({ watermark })
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
