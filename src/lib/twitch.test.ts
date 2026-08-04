import { describe, expect, it } from 'vitest'
import { isValidChannel, parsePrivmsg } from './twitch'

describe('isValidChannel', () => {
  it('accepts a Twitch login', () => {
    for (const name of ['micferna', 'a_b_c', 'Streamer99']) {
      expect(isValidChannel(name)).toBe(true)
    }
  })

  it('rejects anything that is not one', () => {
    for (const name of ['', 'ab', 'has space', 'no-dashes', 'x'.repeat(30), 'ünïcode']) {
      expect(isValidChannel(name)).toBe(false)
    }
  })
})

describe('parsePrivmsg', () => {
  it('reads a tagged message', () => {
    const line =
      '@badge-info=;display-name=CoolViewer;mod=0 :coolviewer!coolviewer@coolviewer.tmi.twitch.tv PRIVMSG #channel :!s dune'
    const message = parsePrivmsg(line)

    expect(message?.user).toBe('coolviewer')
    expect(message?.display).toBe('CoolViewer')
    expect(message?.text).toBe('!s dune')
  })

  it('reads an untagged message and falls back to the login for the display name', () => {
    const message = parsePrivmsg(':viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :hello')

    expect(message?.user).toBe('viewer')
    expect(message?.display).toBe('viewer')
    expect(message?.text).toBe('hello')
  })

  it('keeps a message containing a colon intact', () => {
    const message = parsePrivmsg(':v!v@v.tmi.twitch.tv PRIVMSG #channel :ratio: 10:1')
    expect(message?.text).toBe('ratio: 10:1')
  })

  it('lowercases the login so one viewer cannot vote twice by changing case', () => {
    expect(parsePrivmsg(':ViEwEr!v@v.tmi.twitch.tv PRIVMSG #c :s')?.user).toBe('viewer')
  })

  it('ignores everything that is not a PRIVMSG', () => {
    for (const line of [
      'PING :tmi.twitch.tv',
      ':tmi.twitch.tv 001 justinfan1 :Welcome',
      ':v!v@v.tmi.twitch.tv JOIN #channel',
      'garbage',
      '',
      '@only=tags',
    ]) {
      expect(parsePrivmsg(line)).toBeNull()
    }
  })
})
