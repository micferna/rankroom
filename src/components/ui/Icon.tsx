/**
 * A hand-rolled icon set rather than a dependency: the app needs two dozen
 * glyphs, and shipping an icon library would add weight and a supply-chain
 * surface for something this small. All are 24×24, stroked, currentColor.
 */

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M4 12.5l5 5L20 6.5',
  undo: 'M9 14L4 9l5-5M4 9h9a7 7 0 010 14h-3',
  redo: 'M15 14l5-5-5-5M20 9h-9a7 7 0 000 14h3',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  upload: 'M12 17V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v13M7 12l5 5 5-5M4 20h16',
  share: 'M4 12v8h16v-8M12 3v13M8 7l4-4 4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M17 3l4 4-4 4M14 10l3-3h4M17 13l4 4-4 4',
  duel: 'M4 4l7 7M20 4l-7 7M9 13l-5 5 2 2 5-5M15 13l5 5-2 2-5-5M12 10l2 2-2 2-2-2z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M8 4v16M16 4v16',
  record: 'M12 4a8 8 0 100 16 8 8 0 000-16z',
  stop: 'M6 6h12v12H6z',
  rewind: 'M11 6L4 12l7 6zM20 6l-7 6 7 6z',
  film: 'M3 4h18v16H3zM3 8h18M3 16h18M7 4v4M7 16v4M17 4v4M17 16v4',
  compare: 'M12 3v18M7 8L3 12l4 4M17 8l4 4-4 4',
  broadcast:
    'M12 10a2 2 0 100 4 2 2 0 000-4zM8 8a5.5 5.5 0 000 8M16 8a5.5 5.5 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14',
  sun: 'M12 7a5 5 0 100 10 5 5 0 000-10zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  settings:
    'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 13.5l1.8 1.4-2 3.4-2.2-.8a7.6 7.6 0 01-1.7 1l-.3 2.3h-4l-.3-2.3a7.6 7.6 0 01-1.7-1l-2.2.8-2-3.4 1.8-1.4a7.7 7.7 0 010-2l-1.8-1.4 2-3.4 2.2.8a7.6 7.6 0 011.7-1L10.9 3h4l.3 2.3a7.6 7.6 0 011.7 1l2.2-.8 2 3.4-1.8 1.4a7.7 7.7 0 010 2z',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l4.5 4.5',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
  arrowLeft: 'M20 12H4M10 6l-6 6 6 6',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  target:
    'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5a.5.5 0 100 1 .5.5 0 000-1z',
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  className?: string
  /** Icons are decorative unless they carry the only label for a control. */
  title?: string
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  )
}
