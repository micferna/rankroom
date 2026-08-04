import { useT } from '~/i18n'
import { modLabel } from '~/hooks/useHotkeys'
import { BARS } from '~/lib/palette'
import { AddTiles } from './AddTiles'

interface TestCardProps {
  onPickFiles: () => void
  onAddTiles: (labels: string[]) => void
}

/**
 * The empty state is a broadcast test pattern, because that is exactly what an
 * empty board is: a channel with nothing on it yet. It doubles as the drop
 * target and the onboarding copy, so there is no separate tutorial to dismiss.
 */
export function TestCard({ onPickFiles, onAddTiles }: TestCardProps) {
  const t = useT()

  return (
    <div className="animate-rise overflow-hidden rounded-panel border border-edge">
      <div className="flex h-16 sm:h-24" aria-hidden>
        {BARS.map((color, index) => (
          <div
            key={color}
            className="animate-slate-wipe flex-1"
            style={{ backgroundColor: color, animationDelay: `${index * 45}ms` }}
          />
        ))}
      </div>

      <div className="bg-desk px-4 py-6 text-center sm:px-8">
        <p className="slug">{t('empty.slug')}</p>
        <h2 className="type-display mt-1.5 text-xl sm:text-2xl">{t('empty.title')}</h2>
        <p className="mx-auto mt-2 max-w-[52ch] text-sm leading-relaxed text-slate">
          {t('empty.body')}
        </p>

        <div className="mx-auto mt-5 flex max-w-sm flex-col items-center gap-2">
          <button
            type="button"
            onClick={onPickFiles}
            className="h-8 w-full rounded-control bg-preview px-4 text-sm font-semibold text-room transition-[filter] hover:brightness-110"
          >
            {t('empty.chooseImages')}
          </button>
          <AddTiles onAdd={onAddTiles} className="w-full" placeholder={t('empty.addPlaceholder')} />
        </div>

        <p className="type-mono mt-4 hidden text-[10px] text-slate sm:block">
          {t('empty.tip', { key: `${modLabel()} K` })}
        </p>
      </div>
    </div>
  )
}
