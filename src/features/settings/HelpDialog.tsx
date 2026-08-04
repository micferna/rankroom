import { Modal } from '~/components/ui/Modal'
import { modLabel } from '~/hooks/useHotkeys'
import { useT } from '~/i18n'
import type { MessageKey } from '~/i18n/en'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

const SECTIONS = [
  {
    title: 'help.everywhere',
    rows: [
      ['mod K', 'help.k.palette'],
      ['mod Z', 'help.k.undo'],
      ['mod ⇧ Z', 'help.k.redo'],
      ['mod S', 'help.k.save'],
      ['mod E', 'help.k.export'],
      ['Esc', 'help.k.escape'],
    ],
  },
  {
    title: 'help.board',
    rows: [
      ['Space', 'help.k.drag'],
      ['mod V', 'help.k.paste'],
      ['Delete', 'help.k.delete'],
    ],
  },
  {
    title: 'help.duel',
    rows: [
      ['← →', 'help.k.duelPick'],
      ['Space', 'help.k.duelTie'],
      ['S', 'help.k.duelSkip'],
      ['U', 'help.k.duelUndo'],
    ],
  },
  {
    title: 'help.stream',
    rows: [
      ['1 – 9', 'help.k.streamPlace'],
      ['U', 'help.k.streamUndo'],
    ],
  },
] as const satisfies readonly {
  title: MessageKey
  rows: readonly (readonly [string, MessageKey])[]
}[]

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const t = useT()
  const mod = modLabel()

  return (
    <Modal open={open} onClose={onClose} size="lg" title={t('help.title')} hint={t('help.hint')}>
      <div className="grid gap-6 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.title}>
            <p className="slug mb-2">{t(section.title)}</p>
            <dl className="flex flex-col gap-1.5">
              {section.rows.map(([keys, description]) => (
                <div key={keys} className="flex items-start justify-between gap-3">
                  <dd className="order-2 text-right text-xs text-slate">{t(description)}</dd>
                  <dt className="order-1 shrink-0">
                    {keys.split(' ').map((key, index) => (
                      // A row can repeat a key, so the index is part of the identity.
                      <kbd key={`${key}-${index}`} className="kbd mr-1">
                        {key === 'mod' ? mod : key}
                      </kbd>
                    ))}
                  </dt>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="mt-6 border-t border-edge pt-4 text-xs leading-relaxed text-slate">
        {t('help.privacy')}
      </p>
    </Modal>
  )
}
