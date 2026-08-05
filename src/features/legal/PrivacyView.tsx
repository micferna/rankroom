import { useEffect, useState } from 'react'
import { go } from '~/app/route'
import { Button } from '~/components/ui/Button'
import { useLocale } from '~/i18n'
import * as api from '~/lib/api'
import { policyFor } from './policy'

/**
 * The privacy policy at `#/privacy`.
 *
 * A page rather than a dialog: it has to survive being linked to, bookmarked
 * and read on a phone by somebody deciding whether to sign in at all.
 */
export function PrivacyView() {
  const locale = useLocale()
  const policy = policyFor(locale)
  const [contact, setContact] = useState<string | null>(null)

  useEffect(() => {
    if (!api.configured) return
    let cancelled = false

    api
      .serverConfig()
      .then((config) => {
        if (!cancelled) setContact(config.privacy_contact)
      })
      .catch(() => {
        // Without a reachable server there is no controller to name, and the
        // page says so. A failed lookup and an unset address read the same.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="type-display text-2xl">{policy.title}</h1>
        <p className="text-xs text-chalk/50">{policy.updated}</p>
      </header>

      {policy.intro.map((paragraph) => (
        <p key={paragraph.slice(0, 40)} className="text-sm leading-relaxed text-chalk/85">
          {paragraph}
        </p>
      ))}

      {policy.sections.map((section) => (
        <section key={section.heading} className="flex flex-col gap-2">
          <h2 className="type-display text-base">{section.heading}</h2>

          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="text-sm leading-relaxed text-chalk/85">
              {paragraph}
            </p>
          ))}

          {section.rows ? (
            <dl className="flex flex-col gap-1.5">
              {section.rows.map(([term, detail]) => (
                <div
                  key={term}
                  className="flex flex-col gap-0.5 rounded-control bg-room/60 px-3 py-2 sm:flex-row sm:gap-3"
                >
                  <dt className="type-display shrink-0 text-xs sm:w-44">{term}</dt>
                  <dd className="text-xs leading-relaxed text-chalk/70">{detail}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* The contact belongs to whoever runs this instance, so it comes
              from that server. Unset, the page says so rather than invent one. */}
          {section === policy.sections[0] ? (
            <p className="text-sm leading-relaxed text-chalk/85">
              {contact ? (
                contact.includes('@') ? (
                  <a className="underline underline-offset-2" href={`mailto:${contact}`}>
                    {contact}
                  </a>
                ) : (
                  contact
                )
              ) : (
                <span className="text-chalk/60">{policy.noContact}</span>
              )}
            </p>
          ) : null}
        </section>
      ))}

      <footer>
        <Button
          icon="arrowLeft"
          onClick={() => {
            go('#/')
          }}
        >
          {policy.back}
        </Button>
      </footer>
    </main>
  )
}
