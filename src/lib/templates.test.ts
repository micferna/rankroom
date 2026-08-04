import { describe, expect, it } from 'vitest'
import { DEFAULT_TIER_LABELS } from './board'
import { PALETTES } from './palette'
import {
  boardFromTemplate,
  searchTemplates,
  TEMPLATE_CATEGORIES,
  TEMPLATES,
  templatesFor,
} from './templates'
import type { Locale } from '~/i18n/locale'

const LOCALES: Locale[] = ['en', 'fr']

describe('the shipped templates', () => {
  it('have unique ids', () => {
    const ids = TEMPLATES.map((template) => template.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('are translated into every locale', () => {
    for (const template of TEMPLATES) {
      for (const locale of LOCALES) {
        expect(template.name[locale], `${template.id} name.${locale}`).toBeTruthy()
        expect(template.note[locale], `${template.id} note.${locale}`).toBeTruthy()
      }
    }
  })

  it('translate their custom ladders into every locale, with matching lengths', () => {
    for (const template of TEMPLATES) {
      if (!template.tiers) continue
      expect(template.tiers.fr).toHaveLength(template.tiers.en.length)
      for (const locale of LOCALES) {
        expect(template.tiers[locale].every(Boolean), `${template.id} tiers.${locale}`).toBe(true)
      }
    }
  })

  it('use a category the gallery knows how to show', () => {
    for (const template of TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(template.category)
    }
  })

  it('only reference palettes that exist', () => {
    const ids = new Set(PALETTES.map((palette) => palette.id))
    for (const template of TEMPLATES) {
      if (template.palette) expect(ids, template.id).toContain(template.palette)
    }
  })

  it('hold enough items to be worth ranking, with no duplicates', () => {
    for (const template of TEMPLATES) {
      expect(template.items.length, `${template.id} is too short`).toBeGreaterThanOrEqual(6)
      expect(new Set(template.items).size, `${template.id} repeats an item`).toBe(
        template.items.length,
      )
      expect(template.items.every((item) => item.trim().length > 0)).toBe(true)
    }
  })

  it('carry no image data — templates are text only, by design', () => {
    const serialised = JSON.stringify(TEMPLATES)
    expect(serialised).not.toContain('data:image')
    expect(serialised).not.toContain('http')
  })
})

describe('templatesFor', () => {
  it('offers unrestricted templates in both locales', () => {
    const shared = TEMPLATES.filter((template) => !template.locales)
    for (const locale of LOCALES) {
      const ids = new Set(templatesFor(locale).map((template) => template.id))
      for (const template of shared) expect(ids).toContain(template.id)
    }
  })

  it('hides a locale-restricted template from other locales', () => {
    const restricted = TEMPLATES.find((template) => template.locales?.includes('fr'))
    expect(restricted, 'expected at least one French-only template').toBeDefined()

    expect(templatesFor('fr').map((t) => t.id)).toContain(restricted!.id)
    expect(templatesFor('en').map((t) => t.id)).not.toContain(restricted!.id)
  })
})

describe('searchTemplates', () => {
  const all = templatesFor('en')

  it('returns everything for an empty query', () => {
    expect(searchTemplates(all, '   ', 'en')).toHaveLength(all.length)
  })

  it('matches the template name', () => {
    const found = searchTemplates(all, 'ghibli', 'en')
    expect(found.map((template) => template.id)).toContain('ghibli')
  })

  it('matches an item inside a template, not just its title', () => {
    const found = searchTemplates(all, 'bloodborne', 'en')
    expect(found.map((template) => template.id)).toContain('fromsoftware')
  })

  it('is case-insensitive', () => {
    expect(searchTemplates(all, 'ELDEN', 'en')).toEqual(searchTemplates(all, 'elden', 'en'))
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(searchTemplates(all, 'zzzzqqqq', 'en')).toEqual([])
  })
})

describe('boardFromTemplate', () => {
  const withLadder = TEMPLATES.find((template) => template.tiers)!
  const withoutLadder = TEMPLATES.find((template) => !template.tiers)!

  it('puts every item on the bench, ready to rank', () => {
    const board = boardFromTemplate(withoutLadder, 'en')

    expect(board.bench).toHaveLength(withoutLadder.items.length)
    expect(board.tiers.every((tier) => tier.itemIds.length === 0)).toBe(true)
    expect(Object.values(board.items).map((item) => item.label)).toEqual(withoutLadder.items)
  })

  it('titles the board after the template, in the active locale', () => {
    expect(boardFromTemplate(withoutLadder, 'fr').title).toBe(withoutLadder.name.fr)
    expect(boardFromTemplate(withoutLadder, 'en').title).toBe(withoutLadder.name.en)
  })

  it('uses the default ladder when the template does not bring one', () => {
    const board = boardFromTemplate(withoutLadder, 'en')
    expect(board.tiers.map((tier) => tier.label)).toEqual([...DEFAULT_TIER_LABELS])
  })

  it('uses the template ladder when it has one, translated', () => {
    for (const locale of LOCALES) {
      const board = boardFromTemplate(withLadder, locale)
      expect(board.tiers.map((tier) => tier.label)).toEqual(withLadder.tiers?.[locale])
    }
  })

  it('gives every tier a distinct id and a real colour', () => {
    const board = boardFromTemplate(withLadder, 'en')
    const ids = board.tiers.map((tier) => tier.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(board.tiers.every((tier) => /^#[0-9a-f]{6}$/i.test(tier.color))).toBe(true)
  })

  it('produces a board that is independent of the template', () => {
    const first = boardFromTemplate(withoutLadder, 'en')
    const second = boardFromTemplate(withoutLadder, 'en')

    expect(first.id).not.toBe(second.id)
    expect(first.bench[0]).not.toBe(second.bench[0])
  })
})
