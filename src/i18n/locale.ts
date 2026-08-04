/**
 * Locale identity only. Kept separate from the translator so the UI store can
 * import it without a cycle (the translator reads the locale from that store).
 */
export type Locale = 'en' | 'fr'

export const LOCALES: { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'fr', label: 'Français', short: 'FR' },
]

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'fr'
}

/** The locale the browser asks for, when it is one we ship. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en'
  return navigator.languages.some((tag) => tag.toLowerCase().startsWith('fr')) ? 'fr' : 'en'
}
