import { useCallback, useEffect, useState } from 'react'
import { profileUrl } from '~/app/route'
import { Button, IconButton } from '~/components/ui/Button'
import { Switch } from '~/components/ui/Field'
import { Modal } from '~/components/ui/Modal'
import { useT, type Translate } from '~/i18n'
import * as api from '~/lib/api'
import { errorKey } from '~/lib/errors'
import { useAccountStore } from '~/store/accountStore'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'

interface AccountDialogProps {
  open: boolean
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
 * Everything the server adds, in one place.
 *
 * This dialog is the only part of the app that knows a server can exist. When
 * one is not configured it is never opened and the button that opens it is
 * never rendered — the app is unchanged, which is the point of the whole
 * arrangement.
 */
export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const t = useT()
  const notify = useUiStore((state) => state.notify)

  const status = useAccountStore((state) => state.status)
  const account = useAccountStore((state) => state.account)
  const boards = useAccountStore((state) => state.boards)
  const linkedId = useAccountStore((state) => state.linkedId)
  const overlay = useAccountStore((state) => state.overlay)
  const busy = useAccountStore((state) => state.busy)
  const refresh = useAccountStore((state) => state.refresh)
  const refreshBoards = useAccountStore((state) => state.refreshBoards)
  const setLinked = useAccountStore((state) => state.setLinked)
  const setOverlay = useAccountStore((state) => state.setOverlay)
  const setBusy = useAccountStore((state) => state.setBusy)
  const clear = useAccountStore((state) => state.clear)

  const board = useBoardStore((state) => state.board)
  const replaceBoard = useBoardStore((state) => state.replaceBoard)

  const [confirmingBoard, setConfirmingBoard] = useState<string | null>(null)
  const [confirmingAccount, setConfirmingAccount] = useState(false)
  const [publish, setPublish] = useState(false)

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  useEffect(() => {
    if (open && status === 'signedIn') void refreshBoards()
  }, [open, status, refreshBoards])

  /** Runs a server call with the busy flag and one error path for all of them. */
  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      try {
        await action()
      } catch (error) {
        notify(t(errorKey(error, 'account.errorRequest')), 'bad')
        // A call that failed because the session went away should not leave the
        // dialog claiming to be signed in.
        if (errorKey(error, 'account.errorRequest') === 'account.errorSignedOut') clear()
      } finally {
        setBusy(false)
      }
    },
    [clear, notify, setBusy, t],
  )

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => {
          notify(t('account.copied'), 'good')
        })
        .catch(() => {
          notify(t('share.copyFailed'), 'bad')
        })
    },
    [notify, t],
  )

  const linked = boards.find((entry) => entry.id === linkedId) ?? null

  const body = () => {
    if (status === 'checking' || status === 'unknown') {
      return <p className="text-sm text-chalk/70">{t('account.checking')}</p>
    }

    if (status === 'unavailable') {
      return <p className="text-sm text-chalk/70">{t('account.unavailable')}</p>
    }

    if (status === 'anonymous') {
      return (
        <div className="flex flex-col gap-3">
          <Button
            variant="primary"
            icon="broadcast"
            onClick={() => {
              // A full navigation, not a fetch: OAuth is a redirect flow, and
              // the server sets a cookie that binds the handshake to this
              // browser on the way out.
              window.location.href = api.signInUrl()
            }}
          >
            {t('account.signIn')}
          </Button>
          <p className="text-xs leading-relaxed text-chalk/60">{t('account.signInHint')}</p>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-5">
        <section className="flex flex-wrap items-center gap-2">
          {account?.avatar_url ? (
            <img
              src={account.avatar_url}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-full"
            />
          ) : null}
          <p className="min-w-0 flex-1 truncate text-sm">
            {t('account.signedInAs', { name: account?.display_name ?? '' })}
          </p>
          {account ? (
            <Button
              size="sm"
              icon="share"
              onClick={() => {
                copy(profileUrl(account.login))
              }}
            >
              {t('account.yourPage')}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                await api.signOut()
                clear()
              })
            }}
          >
            {t('account.signOut')}
          </Button>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="type-display text-sm">{t('account.boards')}</h3>

          <div className="flex flex-wrap items-center gap-2">
            <Switch
              label={t('account.public')}
              checked={publish}
              onChange={setPublish}
              hint={t('account.publicHint')}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon="upload"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const saved = linked
                    ? await api.updateBoard(linked.id, board, publish)
                    : await api.createBoard(board, publish)
                  setLinked(saved.id)
                  await refreshBoards()
                  notify(t(linked ? 'account.updated' : 'account.saved'), 'good')
                })
              }}
            >
              {linked ? t('account.update') : t('account.save')}
            </Button>
          </div>

          {boards.length === 0 ? (
            <p className="text-sm text-chalk/60">{t('account.boardsEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {boards.map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-control bg-room/60 px-2.5 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
                  <span className="shrink-0 text-xs text-chalk/50">
                    {entry.is_public ? t('account.public') : t('account.private')} ·{' '}
                    {relative(entry.updated_at, t)}
                  </span>

                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        replaceBoard(await api.openBoard(entry.id))
                        setLinked(entry.id)
                        setPublish(entry.is_public)
                        onClose()
                      })
                    }}
                  >
                    {t('account.open.board')}
                  </Button>

                  {confirmingBoard === entry.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          void run(async () => {
                            await api.deleteBoard(entry.id)
                            if (linkedId === entry.id) setLinked(null)
                            setConfirmingBoard(null)
                            await refreshBoards()
                            notify(t('account.deleted'), 'good')
                          })
                        }}
                      >
                        {t('account.confirmDelete')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setConfirmingBoard(null)
                        }}
                      >
                        {t('account.cancel')}
                      </Button>
                    </>
                  ) : (
                    <IconButton
                      icon="trash"
                      label={t('account.delete')}
                      onClick={() => {
                        setConfirmingBoard(entry.id)
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="type-display text-sm">{t('account.overlay')}</h3>
          <p className="text-xs leading-relaxed text-chalk/60">{t('account.overlayHint')}</p>

          {overlay ? (
            <>
              <code className="block truncate rounded-control bg-room/60 px-2.5 py-2 text-xs">
                {overlay.url}
              </code>
              <p className="text-xs leading-relaxed text-flare">{t('account.overlayWarn')}</p>
            </>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              icon={overlay ? 'shuffle' : 'broadcast'}
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const issued = await api.rotateOverlayKey()
                  setOverlay(issued)
                  notify(t(overlay ? 'account.overlayRotated' : 'account.saved'), 'good')
                })
              }}
            >
              {overlay ? t('account.overlayRotate') : t('account.overlayCreate')}
            </Button>
            {overlay ? (
              <Button
                icon="copy"
                onClick={() => {
                  copy(overlay.url)
                }}
              >
                {t('account.copyLink')}
              </Button>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-2 border-t border-chalk/10 pt-4">
          <h3 className="type-display text-sm text-program">{t('account.danger')}</h3>
          <p className="text-xs leading-relaxed text-chalk/60">{t('account.dangerHint')}</p>

          {confirmingAccount ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                icon="trash"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await api.deleteAccount()
                    clear()
                    setConfirmingAccount(false)
                    notify(t('account.dangerDone'), 'good')
                  })
                }}
              >
                {t('account.dangerConfirm')}
              </Button>
              <Button
                onClick={() => {
                  setConfirmingAccount(false)
                }}
              >
                {t('account.cancel')}
              </Button>
            </div>
          ) : (
            <div>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  setConfirmingAccount(true)
                }}
              >
                {t('account.danger')}
              </Button>
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('account.title')}
      hint={t('account.hint')}
    >
      {body()}
    </Modal>
  )
}
