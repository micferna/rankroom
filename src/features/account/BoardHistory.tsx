import { useCallback, useEffect, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { useT, type Translate } from '~/i18n'
import * as api from '~/lib/api'
import { errorKey } from '~/lib/errors'
import { useUiStore } from '~/store/uiStore'

interface BoardHistoryProps {
  boardId: string
  /** Called after a restore, so the caller can reload what it is showing. */
  onRestored: () => void
  onClose: () => void
}

function relative(iso: string, t: Translate): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes', { count: minutes })
  if (minutes < 1440) return t('time.hours', { count: Math.round(minutes / 60) })
  return t('time.days', { count: Math.round(minutes / 1440) })
}

/**
 * Previous states of one board, and a way back to any of them.
 *
 * Inline rather than a dialog of its own: it is opened from a row in a list and
 * belongs to that row, and a second modal over the first is a worse place to
 * make a decision about which version you want.
 */
export function BoardHistory({ boardId, onRestored, onClose }: BoardHistoryProps) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const [versions, setVersions] = useState<api.BoardVersion[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api
      .versions(boardId)
      .then(setVersions)
      .catch((error: unknown) => {
        notify(t(errorKey(error, 'account.errorRequest')), 'bad')
        setVersions([])
      })
  }, [boardId, notify, t])

  useEffect(load, [load])

  const restore = useCallback(
    (versionId: string) => {
      setBusy(true)
      api
        .restoreVersion(boardId, versionId)
        .then(() => {
          notify(t('history.restored'), 'good')
          onRestored()
          load()
        })
        .catch((error: unknown) => {
          notify(t(errorKey(error, 'account.errorRequest')), 'bad')
        })
        .finally(() => {
          setBusy(false)
        })
    },
    [boardId, load, notify, onRestored, t],
  )

  return (
    <div className="flex w-full flex-col gap-2 rounded-control bg-room/40 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="type-display text-xs">{t('history.title')}</h4>
        <Button size="sm" onClick={onClose}>
          {t('history.close')}
        </Button>
      </div>

      {versions === null ? (
        <p className="text-xs text-chalk/60">{t('profile.loading')}</p>
      ) : versions.length === 0 ? (
        <p className="text-xs leading-relaxed text-chalk/60">{t('history.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-control bg-room/60 px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs">{version.title}</span>
              <span className="shrink-0 text-xs text-chalk/50">
                {relative(version.saved_at, t)} ·{' '}
                {t('admin.boardCount', { count: version.item_count })}
              </span>
              <Button
                size="sm"
                icon="undo"
                disabled={busy}
                onClick={() => {
                  restore(version.id)
                }}
              >
                {t('history.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* Said plainly, because it is a real limit and not a detail: history is
          best-effort, and the export is the copy that belongs to the user. */}
      <p className="text-xs leading-relaxed text-chalk/50">{t('history.hint')}</p>
    </div>
  )
}
