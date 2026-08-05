import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Board } from '~/types'

/**
 * The API client, tested against a stubbed `fetch`.
 *
 * What matters here is not that requests are sent — that is one line of code —
 * but what happens when they come back wrong. A server answer is untrusted
 * input like any other, and the interesting cases are the ones where it is
 * hostile, malformed, or absent.
 *
 * The module reads `VITE_API_URL` at import time, so each test imports it fresh
 * with the environment it needs.
 */

async function load(apiUrl: string | undefined) {
  vi.resetModules()
  vi.stubEnv('VITE_API_URL', apiUrl ?? '')
  return import('./api')
}

function board(): Board {
  return {
    schema: 1,
    id: 'b1',
    title: 'Board',
    subtitle: '',
    tiers: [{ id: 't1', label: 'S', color: '#ffffff', itemIds: [] }],
    bench: [],
    items: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('without a server', () => {
  it('reports itself unconfigured and never reaches the network', async () => {
    const api = await load(undefined)

    expect(api.configured).toBe(false)
    // Matched on the key rather than the class: `resetModules` gives this
    // import its own copy of the error class, so `instanceof` against the one
    // in scope here would compare two identical-but-distinct constructors.
    await expect(api.listBoards()).rejects.toMatchObject({ key: 'account.errorNoServer' })
    // The whole point of the feature flag: no server means no requests, not
    // requests that fail. A build without one is the app as it always was.
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('with a server', () => {
  it('sends cookies, because the session is one', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ boards: [] }))

    await api.listBoards()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // The session cookie is HttpOnly, so it cannot be read and attached by
    // hand — the request has to opt in to sending it.
    expect(init.credentials).toBe('include')
  })

  it('declares JSON on anything with a body', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ id: 'x' }))

    await api.createBoard(board(), false)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    // Not only correctness: a JSON content type makes the request non-simple,
    // so a browser must preflight it, and a preflight from an unknown origin
    // never becomes a request.
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.method).toBe('POST')
  })

  it('does not declare a body type when there is no body', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await api.signOut()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
  })

  it('treats being signed out as an answer, not a failure', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorised' }, 401))

    // A visitor who has never signed in is the common case. It resolves to
    // null so the caller shows a sign-in button rather than an error.
    await expect(api.me()).resolves.toBeNull()
  })

  it('translates the server error code rather than its prose', async () => {
    const api = await load('/api')

    const cases: [number, string, string][] = [
      [409, 'quota_exceeded', 'account.errorQuota'],
      [409, 'storage_exceeded', 'account.errorStorage'],
      [503, 'sign_in_unavailable', 'account.errorNoSignIn'],
      [413, '', 'account.errorTooLarge'],
      [429, '', 'account.errorBusy'],
      [500, '', 'account.errorServer'],
      [400, '', 'account.errorRequest'],
    ]

    for (const [status, code, key] of cases) {
      // The server's prose is written in English and would arrive untranslated;
      // the machine-readable code is what the client reads.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: code, message: 'Something in English' }, status),
      )
      await expect(api.listBoards(), `${status} ${code}`).rejects.toMatchObject({ key })
    }
  })

  it('survives an error body that is not JSON', async () => {
    const api = await load('/api')
    // A reverse proxy returning its own HTML error page is the usual way this
    // happens, and it must not become a parse exception on top of the failure.
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))

    await expect(api.listBoards()).rejects.toMatchObject({ key: 'account.errorServer' })
  })

  it('reports a dead server as offline rather than as a rejection', async () => {
    const api = await load('/api')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(api.listBoards()).rejects.toMatchObject({ key: 'account.errorOffline' })
  })

  it('validates a board the server sent, like any other input', async () => {
    const api = await load('/api')
    // "It came from our own server" is not a reason to skip the parser. The
    // parser is what guarantees the shape the rest of the app assumes, and a
    // compromised or simply buggy server is exactly when that matters.
    fetchMock.mockResolvedValue(jsonResponse({ document: { schema: 99, tiers: [] } }))

    await expect(api.openBoard('id')).rejects.toThrow()
  })

  it('accepts a board the server sent when it is well formed', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(
      jsonResponse({
        document: board(),
        board: { updated_at: '2026-08-05T00:00:00Z' },
        access: 'owner',
      }),
    )

    // The version comes back with the board, because the next save has to say
    // what it was based on or it can silently overwrite somebody else's work.
    await expect(api.openBoard('id')).resolves.toMatchObject({
      board: { title: 'Board' },
      updatedAt: '2026-08-05T00:00:00Z',
      access: 'owner',
    })
  })

  it('sends the version an edit was based on, and only when it has one', async () => {
    const api = await load('/api')
    // A fresh Response per call: a body can only be read once, and reusing one
    // object across two calls fails on the second for a reason that has nothing
    // to do with what is being tested.
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: 'x' })))

    await api.updateBoard('b', board(), false, '2026-08-05T00:00:00Z')
    const [, withVersion] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(withVersion.body as string)).toMatchObject({
      based_on: '2026-08-05T00:00:00Z',
    })

    // Omitted rather than null: the server reads absence as "not claiming to
    // know", and null would be a claim about a version that does not exist.
    await api.updateBoard('b', board(), false)
    const [, without] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(without.body as string)).not.toHaveProperty('based_on')
  })

  it('joins the configured base to a path without repeating the prefix', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ boards: [] }))

    await api.listBoards()

    // `VITE_API_URL` carries the prefix and the paths do not repeat it. Writing
    // `/api` in both places produced `/api/api/boards`, which only fails against
    // a real server — so it is pinned here.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/boards')
  })

  it('escapes path parameters', async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ login: 'x', display_name: 'x', boards: [] }))

    await api.profile('../../admin')

    const [url] = fetchMock.mock.calls[0] as [string]
    // A login is attacker-supplied whenever a link is. It must stay one path
    // segment rather than climbing out of the API namespace.
    expect(url).not.toContain('../')
    expect(url).toBe('/api/u/..%2F..%2Fadmin')
  })

  it("never sends the item count, which is the server's to decide", async () => {
    const api = await load('/api')
    fetchMock.mockResolvedValue(jsonResponse({ id: 'x' }))

    await api.createBoard(board(), true)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // The client always sends a JSON string; the type is wider than the use.
    const sent = JSON.parse(init.body as string) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['document', 'is_public', 'title'])
  })
})
