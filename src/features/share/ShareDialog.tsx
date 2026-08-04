import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { Switch } from '~/components/ui/Field'
import { Modal } from '~/components/ui/Modal'
import { useT } from '~/i18n'
import { copyText } from '~/lib/download'
import { encodeBoard, SHARE_SIZE_WARNING, shareUrl } from '~/lib/share'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'
import type { Board } from '~/types'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * The whole board travels in the URL fragment, which browsers never send to a
 * server. That is the entire privacy story: there is no upload and no account,
 * and the link works forever because nothing has to stay hosted.
 */
export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const notify = useUiStore((state) => state.notify)

  const [withImages, setWithImages] = useState(true)
  // The built link remembers what it was built from, so "still building" is
  // derived rather than a second piece of state that can fall out of sync.
  const [built, setBuilt] = useState<{ board: Board; images: boolean; url: string } | null>(null)

  const building = built?.board !== board || built.images !== withImages
  const url = building ? '' : built.url

  useEffect(() => {
    if (!open) return

    let cancelled = false
    void encodeBoard(board, { images: withImages })
      .then((token) => {
        if (!cancelled) setBuilt({ board, images: withImages, url: shareUrl(token) })
      })
      .catch(() => {
        if (!cancelled) setBuilt(null)
      })

    return () => {
      cancelled = true
    }
  }, [open, board, withImages])

  const oversized = url.length > SHARE_SIZE_WARNING

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('share.title')}
      hint={t('share.hint')}
      footer={
        <Button
          variant="primary"
          icon="copy"
          disabled={!url || building}
          onClick={() => {
            void copyText(url).then((copied) => {
              notify(copied ? t('share.copied') : t('share.copyFailed'), copied ? 'good' : 'bad')
            })
          }}
        >
          {t('share.copy')}
        </Button>
      }
    >
      <label className="block">
        <span className="slug mb-1.5 block">{t('share.link')}</span>
        <textarea
          readOnly
          rows={4}
          value={building ? t('share.building') : url}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
          className="type-mono w-full resize-none rounded-control border border-edge bg-room/60 p-2.5 text-[11px] leading-relaxed break-all"
        />
      </label>

      <div className="mt-3">
        <Switch
          label={t('share.withImages')}
          hint={t('share.withImagesHint')}
          checked={withImages}
          onChange={setWithImages}
        />
      </div>

      <p className="type-mono mt-3 text-[10px] text-slate">
        {t('share.characters', { count: url.length.toLocaleString() })}
      </p>

      {oversized ? (
        <p className="mt-3 rounded-control border border-tungsten/40 bg-tungsten/10 p-3 text-xs leading-relaxed text-tungsten">
          {t('share.oversized')}
        </p>
      ) : null}
    </Modal>
  )
}
