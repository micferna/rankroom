import { Modal } from '~/components/ui/Modal'
import { useT } from '~/i18n'
import type { MessageKey } from '~/i18n/en'
import { cx } from '~/lib/cx'
import { PALETTES } from '~/lib/palette'
import { useBoardStore } from '~/store/boardStore'

interface PaletteDialogProps {
  open: boolean
  onClose: () => void
}

export function PaletteDialog({ open, onClose }: PaletteDialogProps) {
  const t = useT()
  const paletteId = useBoardStore((state) => state.paletteId)
  const setPalette = useBoardStore((state) => state.setPalette)
  const tierCount = useBoardStore((state) => state.board.tiers.length)

  return (
    <Modal open={open} onClose={onClose} title={t('palette.title')} hint={t('palette.hint')}>
      <div className="flex flex-col gap-2">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            aria-pressed={palette.id === paletteId}
            onClick={() => {
              setPalette(palette.id)
            }}
            className={cx(
              'flex items-center gap-3 rounded-control border p-2.5 text-left transition-colors',
              palette.id === paletteId
                ? 'border-preview/60 bg-preview/8'
                : 'border-edge hover:bg-rail',
            )}
          >
            <span className="flex overflow-hidden rounded-[3px]" aria-hidden>
              {palette.colors.slice(0, tierCount).map((color) => (
                <span key={color} className="h-8 w-4" style={{ backgroundColor: color }} />
              ))}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {t(`palette.${palette.id}` as MessageKey)}
              </span>
              <span className="block text-[11px] text-slate">
                {t(`palette.${palette.id}.note` as MessageKey)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
