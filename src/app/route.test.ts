import { describe, expect, it } from 'vitest'
import { parseRoute } from './route'

/**
 * Routing is a table of regular expressions, which is exactly the kind of code
 * that looks obviously right and is not. The cases that matter are the ones
 * where two prefixes nearly collide.
 */
describe('parseRoute', () => {
  it('sends anything unrecognised to the studio', () => {
    for (const hash of ['', '#', '#/', '#/nonsense', '#/b/', '#/u/', '#/p/']) {
      expect(parseRoute(hash), hash).toEqual({ name: 'studio', token: null })
    }
  })

  it('reads a share token', () => {
    expect(parseRoute('#/b/abc-DEF_123')).toEqual({ name: 'studio', token: 'abc-DEF_123' })
  })

  it('separates the live overlay from a baked one', () => {
    // The generic overlay pattern also matches `#/overlay/live`, so the live
    // route has to be tried first — otherwise `live` is read as a share token
    // and handed to the decompressor.
    expect(parseRoute('#/overlay/live/KEY123')).toEqual({
      name: 'overlayLive',
      token: 'KEY123',
    })
    expect(parseRoute('#/overlay/KEY123')).toEqual({ name: 'overlay', token: 'KEY123' })
    expect(parseRoute('#/overlay')).toEqual({ name: 'overlay', token: null })
  })

  it('keeps published boards out of the share-link namespace', () => {
    // A server slug is twelve to thirty-two lowercase alphanumerics. Routed to
    // `#/b/` it would be treated as a compressed board and fail to open, which
    // is why published boards have a prefix of their own.
    const slug = 'mn4pqr7stuvwxy23'
    expect(parseRoute(`#/p/${slug}`)).toEqual({ name: 'published', token: slug })
    expect(parseRoute(`#/b/${slug}`)).toEqual({ name: 'studio', token: slug })
  })

  it('accepts only login-shaped names on a profile', () => {
    expect(parseRoute('#/u/micferna')).toEqual({ name: 'profile', token: 'micferna' })
    expect(parseRoute('#/u/a_1')).toEqual({ name: 'profile', token: 'a_1' })

    // Twitch logins are letters, digits and underscores, up to 25 characters.
    // Anything else is not a login, and must not become a request path.
    for (const bad of ['#/u/has-dash', '#/u/../etc', '#/u/' + 'x'.repeat(26), '#/u/a%20b']) {
      expect(parseRoute(bad).name, bad).toBe('studio')
    }
  })

  it('rejects slugs the server would never have issued', () => {
    for (const bad of ['#/p/TOOSHORT', '#/p/UPPERCASE1234', '#/p/' + 'a'.repeat(33)]) {
      expect(parseRoute(bad).name, bad).toBe('studio')
    }
  })

  it('finds the account screen', () => {
    expect(parseRoute('#/account')).toEqual({ name: 'account', token: null })
  })
})
