import { useEffect, useState } from 'react'
import { IconButton } from '~/components/ui/Button'
import { useT } from '~/i18n'
import { cx } from '~/lib/cx'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore, type Mode } from '~/store/uiStore'
import type { MessageKey } from '~/i18n/en'

const MODES: { value: Mode; label: MessageKey; hint: MessageKey }[] = [
  { value: 'edit', label: 'mode.edit', hint: 'mode.edit.hint' },
  { value: 'duel', label: 'mode.duel', hint: 'mode.duel.hint' },
  { value: 'stream', label: 'mode.stream', hint: 'mode.stream.hint' },
  { value: 'crowd', label: 'crowd.tab', hint: 'crowd.tab.hint' },
  { value: 'replay', label: 'mode.replay', hint: 'mode.replay.hint' },
  { value: 'compare', label: 'mode.compare', hint: 'mode.compare.hint' },
]

/** Elapsed session time, in the hh:mm:ss a control room would show. */
function useTimecode(startedAt: number): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
}

export function TallyBar() {
  const t = useT()
  const title = useBoardStore((state) => state.board.title)
  const setTitle = useBoardStore((state) => state.setTitle)
  const startedAt = useBoardStore((state) => state.startedAt)

  const mode = useUiStore((state) => state.mode)
  const setMode = useUiStore((state) => state.setMode)
  const live = useUiStore((state) => state.live)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const locale = useUiStore((state) => state.locale)
  const setLocale = useUiStore((state) => state.setLocale)
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const openDialog = useUiStore((state) => state.openDialog)

  const timecode = useTimecode(startedAt)

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-room/90 backdrop-blur-md">
      <div className="flex items-center gap-2 px-2 py-1.5 sm:gap-3 sm:px-3">
        {/* The lamp is the only pulsing thing in the app, and it means one thing. */}
        <div
          className="flex shrink-0 items-center gap-1.5"
          title={live ? t('app.onAir') : t('app.offAir')}
        >
          <span
            className={cx(
              'size-2 rounded-full transition-colors',
              live ? 'tally-lamp bg-program' : 'bg-slate/35',
            )}
            aria-hidden
          />
          <span className="type-display hidden text-xs tracking-[0.14em] sm:inline">
            {t('app.name')}
          </span>
          <span className="sr-only">{live ? t('app.onAir') : t('app.offAir')}</span>
        </div>

        <div className="hidden h-4 w-px shrink-0 bg-edge sm:block" aria-hidden />

        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('app.title.label')}</span>
          <input
            value={title}
            maxLength={120}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
            placeholder={t('app.title.placeholder')}
            className="w-full truncate bg-transparent text-sm font-semibold outline-none placeholder:text-slate/60"
          />
        </label>

        <span className="type-mono hidden shrink-0 text-[10px] text-slate xl:inline" aria-hidden>
          {timecode}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setLocale(locale === 'fr' ? 'en' : 'fr')
            }}
            title={locale === 'fr' ? t('action.languageToEnglish') : t('action.languageToFrench')}
            aria-label={t('action.language')}
            className="type-mono h-7 rounded-control px-1.5 text-[10px] font-bold text-slate transition-colors hover:bg-rail hover:text-chalk"
          >
            {locale === 'fr' ? 'FR' : 'EN'}
          </button>
          <IconButton
            icon="search"
            label={t('action.commandPalette')}
            size="sm"
            onClick={() => {
              setPaletteOpen(true)
            }}
          />
          <IconButton
            icon={theme === 'studio' ? 'sun' : 'moon'}
            label={theme === 'studio' ? t('action.themeToDaylight') : t('action.themeToStudio')}
            size="sm"
            onClick={() => {
              setTheme(theme === 'studio' ? 'daylight' : 'studio')
            }}
          />
          <IconButton
            icon="keyboard"
            label={t('action.shortcuts')}
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => {
              openDialog('help')
            }}
          />
        </div>
      </div>

      {/* The mode bus: one row of buttons, exactly one lit, like a source selector. */}
      <nav
        aria-label={t('mode.nav')}
        className="flex items-stretch gap-px overflow-x-auto border-t border-edge bg-desk/60 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {MODES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            title={t(entry.hint)}
            aria-current={mode === entry.value ? 'page' : undefined}
            onClick={() => {
              setMode(entry.value)
            }}
            className={cx(
              'relative shrink-0 px-2.5 py-1.5 text-xs transition-colors sm:px-3',
              mode === entry.value ? 'text-chalk' : 'text-slate hover:text-chalk',
            )}
          >
            {t(entry.label)}
            <span
              aria-hidden
              className={cx(
                'absolute inset-x-1 bottom-0 h-0.5 rounded-full transition-colors',
                mode === entry.value ? 'bg-preview' : 'bg-transparent',
              )}
            />
          </button>
        ))}
      </nav>
    </header>
  )
}
