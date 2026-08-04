import { beforeEach, describe, expect, it } from 'vitest'
import { addItems, createBoard, createItem } from '~/lib/board'
import type { ChatRoles } from '~/lib/twitch'
import { useBoardStore } from './boardStore'
import { selectTally, useCrowdStore } from './crowdStore'

const roles = (patch: Partial<ChatRoles> = {}): ChatRoles => ({
  subscriber: false,
  moderator: false,
  vip: false,
  broadcaster: false,
  ...patch,
})

function seedBoard() {
  useBoardStore
    .getState()
    .replaceBoard(
      addItems(createBoard({ title: 'Crowd' }), [createItem('Zelda'), createItem('Mario')]),
    )
  return useBoardStore.getState().board
}

describe('crowdStore.ingest', () => {
  beforeEach(() => {
    seedBoard()
    useCrowdStore.setState({ votes: new Map(), feed: [], deckItemId: null })
    useCrowdStore
      .getState()
      .setConfig({ mode: 'free', prefix: '!', blocked: [], subsOnly: false, subWeight: 1 })
  })

  it('turns a chat line into a vote', () => {
    useCrowdStore.getState().ingest('viewer', 'Viewer', '!s zelda')

    const state = useCrowdStore.getState()
    expect(state.votes.size).toBe(1)
    expect(state.feed[0]?.counted).toBe(true)
  })

  it('shows ordinary chat in the feed without counting it', () => {
    useCrowdStore.getState().ingest('viewer', 'Viewer', 'hello everyone')

    const state = useCrowdStore.getState()
    expect(state.votes.size).toBe(0)
    expect(state.feed[0]?.counted).toBe(false)
  })

  it('discards a blocked viewer entirely — not even a feed line', () => {
    useCrowdStore.getState().setConfig({ blocked: ['spammer'] })
    useCrowdStore.getState().ingest('spammer', 'Spammer', '!s zelda')

    const state = useCrowdStore.getState()
    expect(state.votes.size).toBe(0)
    expect(state.feed).toHaveLength(0)
  })

  it('weights a subscriber when the streamer asked for it', () => {
    useCrowdStore.getState().setConfig({ subWeight: 3 })
    useCrowdStore.getState().ingest('sub', 'Sub', '!s zelda', roles({ subscriber: true }))

    expect([...useCrowdStore.getState().votes.values()][0]?.weight).toBe(3)
  })

  it('shows but does not count a non-subscriber in subs-only mode', () => {
    useCrowdStore.getState().setConfig({ subsOnly: true })
    useCrowdStore.getState().ingest('viewer', 'Viewer', '!s zelda')

    const state = useCrowdStore.getState()
    expect(state.votes.size).toBe(0)
    expect(state.feed[0]?.counted).toBe(false)
  })

  it('keeps the feed bounded on a busy chat', () => {
    for (let i = 0; i < 80; i += 1) useCrowdStore.getState().ingest(`u${i}`, `u${i}`, 'spam')
    expect(useCrowdStore.getState().feed.length).toBeLessThanOrEqual(40)
  })
})

describe('selectTally', () => {
  beforeEach(() => {
    seedBoard()
    useCrowdStore.setState({ votes: new Map(), feed: [] })
    useCrowdStore
      .getState()
      .setConfig({ mode: 'free', prefix: '!', blocked: [], subsOnly: false, subWeight: 1 })
  })

  it('reflects what chat said, against the live board', () => {
    for (const user of ['a', 'b', 'c']) useCrowdStore.getState().ingest(user, user, '!s zelda')

    const board = useBoardStore.getState().board
    const tally = selectTally(useCrowdStore.getState().votes, board, 0)

    expect(tally.voters).toBe(3)
    expect([...tally.placements.values()][0]?.tierId).toBe(board.tiers[0]!.id)
  })

  it('hides a placement below the minimum vote count', () => {
    useCrowdStore.getState().ingest('lonely', 'lonely', '!s zelda')

    const board = useBoardStore.getState().board
    expect(selectTally(useCrowdStore.getState().votes, board, 0, 3).placements.size).toBe(0)
  })
})
