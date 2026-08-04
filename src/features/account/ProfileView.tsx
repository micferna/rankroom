import { useEffect, useState } from 'react'
import { go, publishedUrl } from '~/app/route'
import { Button } from '~/components/ui/Button'
import { useT } from '~/i18n'
import * as api from '~/lib/api'
import { errorKey } from '~/lib/errors'

interface ProfileViewProps {
  login: string
}

/**
 * Somebody's public page: `#/u/<channel>`.
 *
 * A read-only surface with no session and no editing. Viewers arrive here from
 * a stream, usually on a phone, so it stays small: a name, a list, and a way in.
 *
 * The server decides what is on it. Boards marked private are not merely hidden
 * from this list — they are not in the response at all, which is the only
 * version of "hidden" worth anything.
 */
export function ProfileView({ login }: ProfileViewProps) {
  const t = useT()
  const [profile, setProfile] = useState<api.PublicProfile | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .profile(login)
      .then((found) => {
        if (!cancelled) setProfile(found)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(t(errorKey(error, 'profile.missing')))
      })

    return () => {
      cancelled = true
    }
  }, [login, t])

  if (failure) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-start justify-center gap-4 px-4">
        <p className="text-sm text-chalk/80">{failure}</p>
        <Button
          icon="arrowLeft"
          onClick={() => {
            go('#/')
          }}
        >
          {t('profile.back')}
        </Button>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl items-center justify-center px-4">
        <p className="text-sm text-chalk/60">{t('profile.loading')}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8">
      <header className="flex items-center gap-3">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full"
          />
        ) : null}
        <div className="min-w-0">
          <h1 className="type-display truncate text-xl">{profile.display_name}</h1>
          <p className="text-xs text-chalk/60">
            {t('profile.boards', { count: profile.boards.length })}
          </p>
        </div>
      </header>

      {profile.boards.length === 0 ? (
        <p className="text-sm text-chalk/60">{t('profile.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {profile.boards.map((board) => (
            <li key={board.slug}>
              <a
                href={publishedUrl(board.slug)}
                className="flex min-w-0 items-center gap-2 rounded-control bg-room/60 px-3 py-2.5 transition-colors hover:bg-room focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-preview"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{board.title}</span>
                <span className="shrink-0 text-xs text-chalk/50">{board.item_count}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <footer>
        <Button
          icon="arrowRight"
          onClick={() => {
            go('#/')
          }}
        >
          {t('profile.back')}
        </Button>
      </footer>
    </main>
  )
}
