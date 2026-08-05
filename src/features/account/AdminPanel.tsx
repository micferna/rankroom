import { useCallback, useEffect, useState } from 'react'
import { Button } from '~/components/ui/Button'
import { useT, type Translate } from '~/i18n'
import * as api from '~/lib/api'
import { errorKey } from '~/lib/errors'
import { cx } from '~/lib/cx'
import { useAccountStore } from '~/store/accountStore'
import { useUiStore } from '~/store/uiStore'

/**
 * What the instance is holding, for whoever runs it.
 *
 * Rendered only when the server recognises this account as an administrator —
 * it answers everybody else exactly as it answers a request for a route that
 * does not exist, so the panel is simply absent rather than refused.
 *
 * It deliberately shows no board titles and no board contents. Running an
 * instance means knowing an account exists and what it costs; it does not mean
 * reading what people ranked.
 */

function megabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** How full something is, as a share, or null when nothing bounds it. */
function share(used: number, limit: number | null): number | null {
  if (limit === null || limit <= 0) return null
  return used / limit
}

function Meter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-room/60 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="type-display text-xs">{label}</span>
        <span className="text-xs text-chalk/60">{detail}</span>
      </div>
      {value === null ? null : (
        <div className="h-1 overflow-hidden rounded-full bg-chalk/10">
          <div
            className={cx(
              'h-full rounded-full transition-[width] duration-500',
              value > 0.9 ? 'bg-program' : value > 0.7 ? 'bg-flare' : 'bg-preview',
            )}
            style={{ width: `${String(Math.min(100, Math.round(value * 100)))}%` }}
          />
        </div>
      )}
    </div>
  )
}

function relative(iso: string, t: Translate): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes', { count: minutes })
  if (minutes < 1440) return t('time.hours', { count: Math.round(minutes / 60) })
  return t('time.days', { count: Math.round(minutes / 1440) })
}

export function AdminPanel() {
  const t = useT()
  const notify = useUiStore((state) => state.notify)
  const admin = useAccountStore((state) => state.admin)
  const account = useAccountStore((state) => state.account)
  const refreshAdmin = useAccountStore((state) => state.refreshAdmin)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void refreshAdmin()
  }, [refreshAdmin])

  const suspend = useCallback(
    (id: string, suspended: boolean) => {
      setBusy(true)
      api
        .setSuspension(id, suspended)
        .then(() => refreshAdmin())
        .then(() => {
          notify(t(suspended ? 'admin.suspended' : 'admin.restored'), 'good')
        })
        .catch((error: unknown) => {
          notify(t(errorKey(error, 'account.errorRequest')), 'bad')
        })
        .finally(() => {
          setBusy(false)
        })
    },
    [notify, refreshAdmin, t],
  )

  if (!admin) return null

  const { usage, limits, accounts, registration } = admin

  return (
    <section className="flex flex-col gap-3 border-t border-chalk/10 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-display text-sm">{t('admin.title')}</h3>
        <span className="text-xs text-chalk/60">
          {t(`admin.registration.${registration.mode}`)}
        </span>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <Meter
          label={t('admin.accounts')}
          value={share(usage.accounts, limits.max_accounts)}
          detail={
            limits.max_accounts === null
              ? t('admin.noLimit', { count: usage.accounts })
              : `${String(usage.accounts)} / ${String(limits.max_accounts)}`
          }
        />
        <Meter
          label={t('admin.stored')}
          value={share(usage.bytes, limits.committed_bytes)}
          detail={
            limits.committed_bytes === null
              ? megabytes(usage.bytes)
              : `${megabytes(usage.bytes)} / ${megabytes(limits.committed_bytes)}`
          }
        />
      </div>

      {/* The number worth knowing before opening registration, and the one an
          operator otherwise works out at the worst possible moment. */}
      {limits.committed_bytes === null ? (
        <p className="text-xs leading-relaxed text-flare">{t('admin.uncapped')}</p>
      ) : (
        <p className="text-xs leading-relaxed text-chalk/60">
          {t('admin.commitment', {
            accounts: limits.max_accounts ?? 0,
            each: megabytes(limits.storage_quota_bytes),
            total: megabytes(limits.committed_bytes),
          })}
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {accounts.map((entry) => (
          <li
            key={entry.id}
            className={cx(
              'flex min-w-0 flex-wrap items-center gap-2 rounded-control px-2.5 py-2',
              entry.suspended_at ? 'bg-program/15' : 'bg-room/60',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {entry.display_name}
              <span className="text-chalk/50"> · {entry.login}</span>
            </span>

            <span className="shrink-0 text-xs text-chalk/50">
              {t('admin.boardCount', { count: entry.boards })} · {megabytes(entry.bytes)} ·{' '}
              {relative(entry.last_seen_at, t)}
            </span>

            {entry.is_admin ? (
              <span className="shrink-0 rounded-control bg-preview/20 px-1.5 py-0.5 text-xs">
                {t('admin.isAdmin')}
              </span>
            ) : (
              <Button
                size="sm"
                variant={entry.suspended_at ? 'quiet' : 'danger'}
                disabled={busy || entry.id === account?.id}
                onClick={() => {
                  suspend(entry.id, entry.suspended_at === null)
                }}
              >
                {t(entry.suspended_at ? 'admin.restore' : 'admin.suspend')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-chalk/60">{t('admin.suspendHint')}</p>
    </section>
  )
}
