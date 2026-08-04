import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton } from '~/components/ui/Button'
import { Modal } from '~/components/ui/Modal'
import { useT, type Translate } from '~/i18n'
import { deleteBoard, listBoards, loadBoard, saveBoard, type BoardSummary } from '~/lib/storage'
import { useBoardStore } from '~/store/boardStore'
import { useUiStore } from '~/store/uiStore'

interface ShelfDialogProps {
  open: boolean
  onClose: () => void
  onOpenFile: () => void
}

function relative(timestamp: number, t: Translate): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return t('time.now')
  if (minutes < 60) return t('time.minutes', { count: minutes })
  if (minutes < 1440) return t('time.hours', { count: Math.round(minutes / 60) })
  return t('time.days', { count: Math.round(minutes / 1440) })
}

/** Boards kept in this browser. Saving is explicit; autosave is separate and invisible. */
export function ShelfDialog({ open, onClose, onOpenFile }: ShelfDialogProps) {
  const t = useT()
  const board = useBoardStore((state) => state.board)
  const replaceBoard = useBoardStore((state) => state.replaceBoard)
  const moves = useBoardStore((state) => state.moves)
  const newBoard = useBoardStore((state) => state.newBoard)
  const notify = useUiStore((state) => state.notify)

  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void listBoards()
      .then(setBoards)
      .catch(() => {
        notify(t('shelf.blocked'), 'bad')
      })
  }, [notify, t])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('shelf.title')}
      hint={t('shelf.hint')}
      footer={
        <>
          <Button
            icon="upload"
            title={t('file.openHint')}
            onClick={() => {
              onClose()
              onOpenFile()
            }}
          >
            {t('file.open')}
          </Button>
          <Button
            icon="plus"
            onClick={() => {
              newBoard()
              onClose()
              notify(t('shelf.created'), 'good')
            }}
          >
            {t('shelf.new')}
          </Button>
          <Button
            variant="primary"
            icon="download"
            onClick={() => {
              void saveBoard(board, moves).then(() => {
                refresh()
                notify(t('shelf.saved', { title: board.title }), 'good')
              })
            }}
          >
            {t('shelf.save')}
          </Button>
        </>
      }
    >
      {boards.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate">{t('shelf.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {boards.map((summary) => (
            <li
              key={summary.id}
              className="flex items-center gap-3 rounded-control border border-edge p-2.5"
            >
              <div className="flex shrink-0 -space-x-2" aria-hidden>
                {summary.cover.length > 0 ? (
                  summary.cover.map((image, index) => (
                    <img
                      key={index}
                      src={image}
                      alt=""
                      className="size-8 rounded-[3px] border border-room object-cover"
                    />
                  ))
                ) : (
                  <span className="grid size-8 place-items-center rounded-[3px] bg-rail text-[10px] text-slate">
                    —
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{summary.title}</p>
                <p className="type-mono text-[10px] text-slate">
                  {t('shelf.summary', {
                    ranked: summary.rankedCount,
                    total: summary.itemCount,
                    when: relative(summary.updatedAt, t),
                  })}
                </p>
              </div>

              {confirming === summary.id ? (
                <div className="hazard flex items-center gap-1 rounded-control px-1.5 py-1">
                  <span className="text-[11px] text-program">{t('shelf.confirm')}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void deleteBoard(summary.id).then(() => {
                        setConfirming(null)
                        refresh()
                      })
                    }}
                  >
                    {t('shelf.yes')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirming(null)
                    }}
                  >
                    {t('shelf.no')}
                  </Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      void loadBoard(summary.id).then((stored) => {
                        if (!stored) return
                        replaceBoard(stored.board)
                        onClose()
                        notify(t('shelf.opened', { title: stored.board.title }), 'good')
                      })
                    }}
                  >
                    {t('shelf.open')}
                  </Button>
                  <IconButton
                    icon="trash"
                    label={t('shelf.delete', { title: summary.title })}
                    size="sm"
                    onClick={() => {
                      setConfirming(summary.id)
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
