/** Turns an arbitrary title into a filename that survives every OS. */
export function slugify(value: string, fallback = 'rankroom'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  return slug || fallback
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in Safari; one frame is enough.
  requestAnimationFrame(() => {
    URL.revokeObjectURL(url)
  })
}

export function downloadText(text: string, filename: string, type = 'application/json'): void {
  downloadBlob(new Blob([text], { type }), filename)
}

/** Copies text, falling back to a hidden textarea where the clipboard API is blocked. */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      // Deprecated, and deliberately so: it is the only copy path left when the
      // async Clipboard API is blocked (no permission, or a non-secure context).
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
