import { useEffect, useMemo, useRef, useState } from 'react'
import { BoardCanvas } from '~/components/board/BoardCanvas'
import { CommandPalette, type Command } from '~/components/CommandPalette'
import { Inspector } from '~/components/Inspector'
import { TallyBar } from '~/components/TallyBar'
import { Toasts } from '~/components/ui/Toasts'
import { CompareMode } from '~/features/compare/CompareMode'
import { CrowdMode } from '~/features/crowd/CrowdMode'
import { DuelMode } from '~/features/duel/DuelMode'
import { ExportDialog } from '~/features/export/ExportDialog'
import { ReplayMode } from '~/features/replay/ReplayMode'
import { HelpDialog } from '~/features/settings/HelpDialog'
import { PaletteDialog } from '~/features/settings/PaletteDialog'
import { ShareDialog } from '~/features/share/ShareDialog'
import { ShelfDialog } from '~/features/shelf/ShelfDialog'
import { StreamMode } from '~/features/stream/StreamMode'
import { useT } from '~/i18n'
import type { MessageKey } from '~/i18n/en'
import { useHotkeys } from '~/hooks/useHotkeys'
import { useImageImport } from '~/hooks/useImageImport'
import { useSession } from '~/hooks/useSession'
import { cx } from '~/lib/cx'
import { imageFilesFrom } from '~/lib/image'
import { saveBoard } from '~/lib/storage'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore, type Mode } from '~/store/uiStore'

interface StudioProps {
  shareToken: string | null
}

export function Studio({ shareToken }: StudioProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const moves = useBoardStore((state) => state.moves)
  const undo = useBoardStore((state) => state.undo)
  const redo = useBoardStore((state) => state.redo)
  const canUndo = useBoardStore((state) => state.canUndo)
  const canRedo = useBoardStore((state) => state.canRedo)
  const newBoard = useBoardStore((state) => state.newBoard)
  const shuffle = useBoardStore((state) => state.shuffle)
  const clearPlacements = useBoardStore((state) => state.clearPlacements)
  const removeItem = useBoardStore((state) => state.removeItem)

  const mode = useUiStore((state) => state.mode)
  const setMode = useUiStore((state) => state.setMode)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const dialog = useUiStore((state) => state.dialog)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const locale = useUiStore((state) => state.locale)
  const setLocale = useUiStore((state) => state.setLocale)
  const notify = useUiStore((state) => state.notify)

  const { importFiles, addTextTiles, pending } = useImageImport()
  useSession(shareToken)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    // Set on mount too, not just on change: the initial locale can come from the
    // browser, and `lang` is what assistive tech reads the page with.
    document.documentElement.lang = locale
  }, [locale])

  // Drops and pastes work anywhere on the page, not just over a drop zone —
  // a creator dragging 40 covers should not have to aim.
  useEffect(() => {
    let depth = 0

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      depth += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      const files = imageFilesFrom(event.dataTransfer)
      if (files.length === 0) return
      event.preventDefault()
      depth = 0
      setDropping(false)
      void importFiles(files)
    }
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesFrom(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      void importFiles(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [importFiles])

  const save = () => {
    void saveBoard(board, moves).then(() => {
      notify(t('shelf.saved', { title: board.title }), 'good')
    })
  }

  const commands = useMemo<Command[]>(() => {
    const go = (id: string, mode: Mode, label: MessageKey, icon: Command['icon']): Command => ({
      id,
      group: t('cmd.group.goTo'),
      label: t(label),
      icon,
      run: () => {
        setMode(mode)
      },
    })

    return [
      go('mode-edit', 'edit', 'mode.edit', 'grid'),
      go('mode-duel', 'duel', 'mode.duel', 'duel'),
      go('mode-stream', 'stream', 'mode.stream', 'broadcast'),
      go('mode-crowd', 'crowd', 'crowd.tab', 'target'),
      go('mode-replay', 'replay', 'mode.replay', 'film'),
      go('mode-compare', 'compare', 'mode.compare', 'compare'),

      {
        id: 'add-images',
        group: t('cmd.group.add'),
        label: t('cmd.addImages'),
        icon: 'image',
        run: () => fileInputRef.current?.click(),
      },

      {
        id: 'export',
        group: t('cmd.group.board'),
        label: t('cmd.export'),
        icon: 'download',
        keys: 'E',
        run: () => {
          openDialog('export')
        },
      },
      {
        id: 'share',
        group: t('cmd.group.board'),
        label: t('cmd.share'),
        icon: 'share',
        run: () => {
          openDialog('share')
        },
      },
      {
        id: 'shelf',
        group: t('cmd.group.board'),
        label: t('cmd.shelf'),
        icon: 'layers',
        run: () => {
          openDialog('shelf')
        },
      },
      {
        id: 'save',
        group: t('cmd.group.board'),
        label: t('cmd.save'),
        icon: 'download',
        keys: 'S',
        run: save,
      },
      { id: 'new', group: t('cmd.group.board'), label: t('cmd.new'), icon: 'plus', run: newBoard },
      {
        id: 'palette',
        group: t('cmd.group.board'),
        label: t('cmd.palette'),
        icon: 'layers',
        run: () => {
          openDialog('palette')
        },
      },

      {
        id: 'shuffle',
        group: t('cmd.group.edit'),
        label: t('cmd.shuffle'),
        icon: 'shuffle',
        run: shuffle,
      },
      {
        id: 'clear',
        group: t('cmd.group.edit'),
        label: t('cmd.clear'),
        icon: 'rewind',
        run: clearPlacements,
      },
      {
        id: 'undo',
        group: t('cmd.group.edit'),
        label: t('action.undo'),
        icon: 'undo',
        disabled: !canUndo(),
        run: undo,
      },
      {
        id: 'redo',
        group: t('cmd.group.edit'),
        label: t('action.redo'),
        icon: 'redo',
        disabled: !canRedo(),
        run: redo,
      },

      {
        id: 'theme',
        group: t('cmd.group.view'),
        label: theme === 'studio' ? t('action.themeToDaylight') : t('action.themeToStudio'),
        icon: theme === 'studio' ? 'sun' : 'moon',
        run: () => {
          setTheme(theme === 'studio' ? 'daylight' : 'studio')
        },
      },
      {
        id: 'language',
        group: t('cmd.group.view'),
        label: locale === 'fr' ? t('action.languageToEnglish') : t('action.languageToFrench'),
        icon: 'settings',
        run: () => {
          setLocale(locale === 'fr' ? 'en' : 'fr')
        },
      },
      {
        id: 'help',
        group: t('cmd.group.view'),
        label: t('action.shortcuts'),
        icon: 'keyboard',
        run: () => {
          openDialog('help')
        },
      },
    ]
    // `save` closes over board and moves, both of which are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    board,
    moves,
    theme,
    locale,
    t,
    canUndo,
    canRedo,
    setMode,
    openDialog,
    newBoard,
    shuffle,
    clearPlacements,
    undo,
    redo,
    setTheme,
    setLocale,
  ])

  useHotkeys({
    'mod+k': () => {
      setPaletteOpen(true)
    },
    'mod+z': undo,
    'mod+shift+z': redo,
    'mod+y': redo,
    'mod+s': save,
    'mod+e': () => {
      openDialog('export')
    },
    Escape: () => {
      setPaletteOpen(false)
      closeDialog()
      setSelectedId(null)
    },
    Delete: () => {
      if (selectedId) {
        removeItem(selectedId)
        setSelectedId(null)
      }
    },
  })

  return (
    <div className="flex min-h-dvh flex-col">
      <TallyBar />

      <main className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-4 px-3 pb-4 lg:flex-row">
        {mode === 'edit' ? (
          <>
            <BoardCanvas
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPickFiles={() => fileInputRef.current?.click()}
              onAddTiles={addTextTiles}
            />
            <Inspector
              selectedId={selectedId}
              onClearSelection={() => {
                setSelectedId(null)
              }}
            />
          </>
        ) : null}
        {mode === 'duel' ? <DuelMode /> : null}
        {mode === 'crowd' ? <CrowdMode /> : null}
        {mode === 'stream' ? <StreamMode /> : null}
        {mode === 'replay' ? <ReplayMode /> : null}
        {mode === 'compare' ? <CompareMode /> : null}
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        multiple
        className="sr-only"
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      {/* Drop affordance: the whole viewport is the target, so it says so. */}
      <div
        aria-hidden
        className={cx(
          'pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-panel border-2 border-dashed border-preview bg-room/70 transition-opacity duration-150',
          dropping ? 'opacity-100' : 'opacity-0',
        )}
      >
        <p className="type-display text-2xl text-preview">Drop to add tiles</p>
      </div>

      {pending > 0 ? (
        <p
          role="status"
          className="type-mono fixed bottom-4 left-4 z-40 rounded-control border border-edge bg-desk px-3 py-2 text-[10px] text-slate"
        >
          {t('drop.decoding', { count: pending })}
        </p>
      ) : null}

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => {
          setPaletteOpen(false)
        }}
      />
      <ExportDialog open={dialog === 'export'} onClose={closeDialog} />
      <ShareDialog open={dialog === 'share'} onClose={closeDialog} />
      <ShelfDialog open={dialog === 'shelf'} onClose={closeDialog} />
      <PaletteDialog open={dialog === 'palette'} onClose={closeDialog} />
      <HelpDialog open={dialog === 'help'} onClose={closeDialog} />
      <Toasts />
    </div>
  )
}
