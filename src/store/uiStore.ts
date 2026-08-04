import { create } from 'zustand'
import { detectLocale, isLocale, type Locale } from '~/i18n/locale'
import { createId } from '~/lib/id'
import { preferences } from '~/lib/storage'
import type { ThemeName } from '~/types'

/** The six things the app can be doing. Only one is active at a time. */
export type Mode = 'edit' | 'duel' | 'stream' | 'crowd' | 'replay' | 'compare'

export type DialogName =
  'export' | 'share' | 'shelf' | 'palette' | 'help' | 'templates' | 'account' | null

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'good' | 'bad'
}

interface UiStore {
  mode: Mode
  theme: ThemeName
  locale: Locale
  /** True while the overlay is on air; drives the tally lamp. */
  live: boolean
  dialog: DialogName
  paletteOpen: boolean
  toasts: Toast[]
  /**
   * Tile edge length in CSS pixels, or 'auto' to follow the viewport.
   * A phone and a 27" monitor want very different sizes, and most people will
   * never touch the slider — so the default adapts and the slider overrides it.
   */
  tileSize: number | 'auto'

  setMode: (mode: Mode) => void
  setTileSize: (size: number | 'auto') => void
  setTheme: (theme: ThemeName) => void
  setLocale: (locale: Locale) => void
  setLive: (live: boolean) => void
  openDialog: (dialog: Exclude<DialogName, null>) => void
  closeDialog: () => void
  setPaletteOpen: (open: boolean) => void
  notify: (message: string, tone?: Toast['tone']) => void
  dismiss: (id: string) => void
}

const TOAST_MS = 4200

function initialLocale(): Locale {
  const saved = preferences.read<unknown>('locale', null)
  return isLocale(saved) ? saved : detectLocale()
}

export const useUiStore = create<UiStore>()((set, get) => ({
  mode: 'edit',
  theme: preferences.read<ThemeName>('theme', 'studio'),
  locale: initialLocale(),
  live: false,
  dialog: null,
  paletteOpen: false,
  toasts: [],
  tileSize: preferences.read<number | 'auto'>('tileSize', 'auto'),

  setMode: (mode) => {
    set({ mode, dialog: null })
  },
  setTileSize: (tileSize) => {
    const next = tileSize === 'auto' ? 'auto' : Math.max(36, Math.min(112, Math.round(tileSize)))
    preferences.write('tileSize', next)
    set({ tileSize: next })
  },
  setTheme: (theme) => {
    preferences.write('theme', theme)
    set({ theme })
  },
  setLocale: (locale) => {
    preferences.write('locale', locale)
    set({ locale })
  },
  setLive: (live) => {
    set({ live })
  },
  openDialog: (dialog) => {
    set({ dialog })
  },
  closeDialog: () => {
    set({ dialog: null })
  },
  setPaletteOpen: (paletteOpen) => {
    set({ paletteOpen })
  },

  notify: (message, tone = 'info') => {
    const id = createId(6)
    set({ toasts: [...get().toasts, { id, message, tone }] })
    setTimeout(() => {
      get().dismiss(id)
    }, TOAST_MS)
  },
  dismiss: (id) => {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) })
  },
}))
