import { create } from 'zustand'
import { preferences } from '~/lib/storage'

/**
 * Who an export is *from*.
 *
 * This belongs to the creator, not to the board: the same handle and logo go on
 * every image they publish, so it lives in preferences rather than in the file.
 */
interface BrandStore {
  /** Free text: a handle, a channel name, a URL. */
  credit: string
  /** Small logo as a data URL, re-encoded like a tile. */
  logo: string | null

  setCredit: (credit: string) => void
  setLogo: (logo: string | null) => void
}

const MAX_CREDIT = 60

export const useBrandStore = create<BrandStore>()((set) => ({
  credit: preferences.read<string>('brand.credit', ''),
  logo: preferences.read<string | null>('brand.logo', null),

  setCredit: (credit) => {
    const trimmed = credit.slice(0, MAX_CREDIT)
    preferences.write('brand.credit', trimmed)
    set({ credit: trimmed })
  },
  setLogo: (logo) => {
    preferences.write('brand.logo', logo)
    set({ logo })
  },
}))
