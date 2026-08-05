import { describe, expect, it } from 'vitest'
import { LOCALES } from '~/i18n/locale'
import { DOCUMENTED_TABLES, policyFor } from './policy'

/**
 * A privacy policy is a claim about what the software does, and claims drift.
 *
 * The usual failure is not dishonesty — it is a migration adding a column
 * nobody thought to mention, months after the text was written. So the text is
 * checked against the schema it describes: if the server starts storing
 * something new, this fails until the policy says so.
 */

/**
 * Every migration, read at build time.
 *
 * A glob rather than a list of filenames: a migration added next year has to be
 * picked up without anyone remembering to name it here, or this stops being the
 * thing that notices drift and becomes decoration.
 */
const MIGRATIONS = import.meta.glob('/server/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function schema(): string {
  const paths = Object.keys(MIGRATIONS).sort()
  // A glob that matched nothing would make every assertion below pass on an
  // empty string, which is the worst possible way for this file to fail.
  expect(paths.length, 'no migrations were found to check the policy against').toBeGreaterThan(0)

  return paths.map((path) => MIGRATIONS[path] ?? '').join('\n')
}

function tablesInSchema(): string[] {
  return [...schema().matchAll(/create table (\w+)/gi)].map((match) => match[1] ?? '')
}

describe('the privacy policy', () => {
  it('names every table the server creates', () => {
    // If a migration adds a table, it holds data about somebody, and the policy
    // has to account for it. Failing here is the reminder.
    expect([...tablesInSchema()].sort()).toEqual([...DOCUMENTED_TABLES].sort())
  })

  it('does not claim tables the server never creates', () => {
    for (const table of DOCUMENTED_TABLES) {
      expect(tablesInSchema(), `${table} is described but not created`).toContain(table)
    }
  })

  it('still tells the truth about what a session row holds', () => {
    // The policy says the token is stored only as a hash. That is the single
    // most load-bearing sentence in it, so it is checked rather than trusted.
    const sessions = /create table sessions \(([\s\S]*?)\n\);/i.exec(schema())?.[1] ?? ''

    expect(sessions).toContain('token_hash')
    expect(sessions).not.toMatch(/\btoken\s+text\b/i)
  })

  it('is written in both languages, with the same structure', () => {
    const [first, ...rest] = LOCALES.map(({ value }) => policyFor(value))
    expect(first).toBeDefined()

    for (const other of rest) {
      // A translation that quietly drops a section is a policy that says
      // different things depending on the reader's browser.
      expect(other.sections).toHaveLength(first?.sections.length ?? 0)
      expect(other.sections.map((section) => section.rows?.length ?? 0)).toEqual(
        first?.sections.map((section) => section.rows?.length ?? 0),
      )
    }
  })

  it('says nothing in one language it does not say in the other', () => {
    for (const { value: locale } of LOCALES) {
      const policy = policyFor(locale)

      expect(policy.title.length, locale).toBeGreaterThan(0)
      expect(policy.updated, locale).toMatch(/2026/)

      for (const section of policy.sections) {
        expect(section.heading.length, `${locale}: empty heading`).toBeGreaterThan(0)
        expect(section.body.length, `${locale}: ${section.heading}`).toBeGreaterThan(0)
        for (const paragraph of section.body) {
          expect(paragraph.trim().length, `${locale}: ${section.heading}`).toBeGreaterThan(20)
        }
      }
    }
  })

  it('promises erasure only because the server cascades', () => {
    // "Deleting your account removes every board" is only true if the foreign
    // keys say so. They do, and this is what keeps it that way.
    const text = schema()

    for (const table of ['sessions', 'boards', 'overlay_keys']) {
      const definition = new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(
        text,
      )?.[1]
      expect(definition, table).toBeDefined()
      expect(definition, `${table} does not cascade, so the policy over-promises`).toMatch(
        /references users \(id\) on delete cascade/i,
      )
    }
  })
})
