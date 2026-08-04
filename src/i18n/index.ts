import { useCallback } from 'react'
import { useUiStore } from '~/store/uiStore'
import { en, type MessageKey } from './en'
import { fr } from './fr'
import type { Locale } from './locale'

export type { MessageKey }
export { detectLocale, isLocale, LOCALES, type Locale } from './locale'

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, fr }

export type TranslateParams = Record<string, string | number>

const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  fr: new Intl.PluralRules('fr'),
}

/**
 * Looks up `key`, selecting a plural form when `params.count` is present, then
 * substitutes `{placeholders}`.
 *
 * A missing key returns the key itself rather than an empty string: a visible
 * `duel.question` in the UI is a bug report, blank space is a mystery.
 */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  // Widened on purpose: plural variants are computed keys that most entries do
  // not define, so the lookup genuinely can miss.
  const dictionary: Partial<Record<string, string>> = DICTIONARIES[locale]
  let template = dictionary[key]

  if (typeof params?.count === 'number') {
    const form = PLURAL_RULES[locale].select(params.count)
    template = dictionary[`${key}_${form}`] ?? dictionary[`${key}_other`] ?? template
  }

  if (template === undefined) return key
  if (!params) return template

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

export type Translate = (key: MessageKey, params?: TranslateParams) => string

/** The translator for the active locale. Stable across renders of the same locale. */
export function useT(): Translate {
  const locale = useUiStore((state) => state.locale)
  return useCallback((key, params) => translate(locale, key, params), [locale])
}

export function useLocale(): Locale {
  return useUiStore((state) => state.locale)
}
