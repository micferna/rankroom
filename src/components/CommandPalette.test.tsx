import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CommandPalette, type Command } from './CommandPalette'

// jsdom ships <dialog> without its modal behaviour.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
})

function commands(run = vi.fn()): Command[] {
  return [
    { id: 'a', group: 'Board', label: 'Save this board', icon: 'download', run },
    { id: 'b', group: 'Go to', label: 'Duel mode', icon: 'duel', run },
    { id: 'c', group: 'Edit', label: 'Undo', icon: 'undo', run, disabled: true },
  ]
}

describe('CommandPalette', () => {
  it('lists every enabled command', () => {
    render(<CommandPalette open commands={commands()} onClose={vi.fn()} />)

    expect(screen.getByText('Save this board')).toBeInTheDocument()
    expect(screen.getByText('Duel mode')).toBeInTheDocument()
    expect(screen.queryByText('Undo')).not.toBeInTheDocument()
  })

  it('filters by subsequence, not just prefix', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open commands={commands()} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Search commands'), 'svbrd')

    expect(screen.getByText('Save this board')).toBeInTheDocument()
    expect(screen.queryByText('Duel mode')).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<CommandPalette open commands={commands()} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Search commands'), 'zzzz')

    expect(screen.getByText('No command matches that.')).toBeInTheDocument()
  })

  it('runs the highlighted command on Enter and closes first', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open commands={commands(run)} onClose={onClose} />)

    await user.keyboard('{Enter}')

    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves the highlight with the arrow keys', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const second = vi.fn()
    const list: Command[] = [
      { id: 'a', group: 'Board', label: 'First', icon: 'plus', run: first },
      { id: 'b', group: 'Board', label: 'Second', icon: 'plus', run: second },
    ]
    render(<CommandPalette open commands={list} onClose={vi.fn()} />)

    await user.keyboard('{ArrowDown}{Enter}')

    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })
})
