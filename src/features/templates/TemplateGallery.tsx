import { useMemo, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { Field } from '~/components/ui/Field'
import { Icon } from '~/components/ui/Icon'
import { Modal } from '~/components/ui/Modal'
import { useLocale, useT } from '~/i18n'
import type { MessageKey } from '~/i18n/en'
import { createItem } from '~/lib/board'
import { cx } from '~/lib/cx'
import { colorAt, paletteById } from '~/lib/palette'
import {
  boardFromTemplate,
  searchTemplates,
  TEMPLATE_CATEGORIES,
  templatesFor,
  type Template,
  type TemplateCategory,
} from '~/lib/templates'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'

interface TemplateGalleryProps {
  open: boolean
  onClose: () => void
}

const CATEGORY_KEY: Record<TemplateCategory, MessageKey> = {
  games: 'templates.category.games',
  screen: 'templates.category.screen',
  music: 'templates.category.music',
  food: 'templates.category.food',
  brands: 'templates.category.brands',
  internet: 'templates.category.internet',
  life: 'templates.category.life',
}

/**
 * The gallery is the real front door: an empty board is a blank page, and most
 * people arrive wanting to rank something that already has a well-known list.
 */
export function TemplateGallery({ open, onClose }: TemplateGalleryProps) {
  const t = useT()
  const locale = useLocale()
  const replaceBoard = useBoardStore((state) => state.replaceBoard)
  const addItems = useBoardStore((state) => state.addItems)
  const setPalette = useBoardStore((state) => state.setPalette)
  const notify = useUiStore((state) => state.notify)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all')

  const available = useMemo(() => templatesFor(locale), [locale])
  const results = useMemo(() => {
    const scoped =
      category === 'all' ? available : available.filter((item) => item.category === category)
    return searchTemplates(scoped, query, locale)
  }, [available, category, query, locale])

  const use = (template: Template) => {
    replaceBoard(boardFromTemplate(template, locale))
    if (template.palette) setPalette(template.palette)
    onClose()
    notify(t('templates.used', { name: template.name[locale] }), 'good')
  }

  const append = (template: Template) => {
    addItems(template.items.map((label) => createItem(label)))
    onClose()
    notify(t('templates.appended', { count: template.items.length }), 'good')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('templates.title')}
      hint={t('templates.hint')}
    >
      <div className="flex flex-col gap-3">
        <Field
          label={t('templates.search')}
          quietLabel
          placeholder={t('templates.searchPlaceholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />

        <div role="group" aria-label={t('templates.filter')} className="flex flex-wrap gap-1">
          {(['all', ...TEMPLATE_CATEGORIES] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={category === entry}
              onClick={() => {
                setCategory(entry)
              }}
              className={cx(
                'rounded-control border px-2.5 py-1 text-xs transition-colors',
                category === entry
                  ? 'border-preview/60 bg-preview/10 text-chalk'
                  : 'border-edge text-slate hover:text-chalk',
              )}
            >
              {entry === 'all' ? t('templates.category.all') : t(CATEGORY_KEY[entry])}
            </button>
          ))}
        </div>

        {results.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate">{t('templates.noMatch')}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {results.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  template={template}
                  onUse={() => {
                    use(template)
                  }}
                  onAppend={() => {
                    append(template)
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        <p className="border-t border-edge pt-3 text-[11px] leading-relaxed text-slate">
          {t('templates.imagesNote')}
        </p>
      </div>
    </Modal>
  )
}

interface TemplateCardProps {
  template: Template
  onUse: () => void
  onAppend: () => void
}

function TemplateCard({ template, onUse, onAppend }: TemplateCardProps) {
  const t = useT()
  const locale = useLocale()
  const palette = paletteById(template.palette ?? 'bars')
  const ladder = template.tiers?.[locale]

  return (
    <article className="flex h-full flex-col gap-2 rounded-control border border-edge p-2.5">
      <div className="flex items-start gap-2">
        {/* The palette strip doubles as the preview of the ladder this template brings. */}
        <span className="mt-0.5 flex shrink-0 overflow-hidden rounded-[3px]" aria-hidden>
          {Array.from({ length: ladder?.length ?? 6 }, (_, index) => (
            <span
              key={index}
              className="h-6 w-1.5"
              style={{ backgroundColor: colorAt(palette, index) }}
            />
          ))}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{template.name[locale]}</h3>
          <p className="text-[11px] text-slate">{template.note[locale]}</p>
        </div>

        <span className="type-mono shrink-0 text-[10px] text-slate">{template.items.length}</span>
      </div>

      {ladder ? (
        <p className="type-mono truncate text-[10px] text-tungsten" title={ladder.join(' · ')}>
          {ladder.join(' · ')}
        </p>
      ) : null}

      <p className="line-clamp-2 text-[11px] text-slate/80">
        {template.items.slice(0, 8).join(' · ')}
      </p>

      <div className="mt-auto flex items-center gap-1 pt-1">
        <Button variant="primary" size="sm" icon="plus" onClick={onUse}>
          {t('templates.use')}
        </Button>
        <button
          type="button"
          onClick={onAppend}
          title={t('templates.appendHint')}
          className="flex items-center gap-1 rounded-control px-2 py-1 text-xs text-slate transition-colors hover:text-chalk"
        >
          <Icon name="layers" size={13} />
          {t('templates.append')}
        </button>
      </div>
    </article>
  )
}
