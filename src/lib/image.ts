import type { MessageKey } from '~/i18n/en'

export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
] as const

export const MAX_SOURCE_BYTES = 12 * 1024 * 1024

/**
 * Tiles never render larger than ~160 CSS px, and exports draw at 2x. 384px of
 * source is plenty, and it keeps a 100-item board inside a shareable link.
 */
const MAX_EDGE = 384
const WEBP_QUALITY = 0.82

/** Same contract as BoardParseError: a message key, translated on display. */
export class ImageImportError extends Error {
  override readonly name = 'ImageImportError'
  readonly key: MessageKey
  readonly params: Record<string, string> | undefined

  constructor(key: MessageKey, params?: Record<string, string>) {
    super(key)
    this.key = key
    this.params = params
  }
}

export function isAcceptedImage(file: File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)
}

/** "kirby-super-star.png" → "Kirby Super Star" */
export function labelFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '')
  const words = stem
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()

  if (!words) return 'Untitled'
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function fit(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_EDGE) return { width, height }

  const scale = MAX_EDGE / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Decodes an image file and re-encodes it as a small WebP data URL.
 *
 * Re-encoding is deliberate: it strips EXIF (including GPS coordinates a creator
 * would not expect to publish in a share link) and caps the payload, so the
 * board stays small enough to travel in a URL.
 */
export async function fileToDataUrl(file: File): Promise<string> {
  if (!isAcceptedImage(file)) {
    throw new ImageImportError('image.unsupported', { type: file.type })
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageImportError('image.tooBig')
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageImportError('image.damaged')
  }

  try {
    const size = fit(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height

    const context = canvas.getContext('2d')
    if (!context) throw new ImageImportError('image.canvasBlocked')

    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, size.width, size.height)

    const url = canvas.toDataURL('image/webp', WEBP_QUALITY)
    // Safari < 16 silently falls back to PNG here, which is larger but valid.
    return url.startsWith('data:image/') ? url : canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}

/** Pulls image files out of a drop or paste, ignoring anything else on the clipboard. */
export function imageFilesFrom(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  return Array.from(transfer.files).filter(isAcceptedImage)
}
