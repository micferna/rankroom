import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BARS } from '~/lib/palette'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a render crash so the page does not go white.
 *
 * That matters more here than in most apps: the board is autosaved to
 * IndexedDB, so a blank page means the user can still *see* nothing while their
 * work is sitting on disk, unreachable. Reloading gets it back — the boundary's
 * job is to say so.
 *
 * The copy is deliberately not translated: the translator lives behind a hook,
 * and a boundary that itself depends on app state is a boundary that can fail
 * the same way twice.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing is sent anywhere — there is no server. The console is the report.
    console.error('RankRoom crashed:', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-dvh place-items-center bg-room px-6 text-chalk">
        <main className="w-full max-w-lg text-center">
          <div
            className="mx-auto mb-8 flex h-2 w-full max-w-sm overflow-hidden rounded-full"
            aria-hidden
          >
            {BARS.map((color) => (
              <span key={color} className="flex-1" style={{ backgroundColor: color }} />
            ))}
          </div>

          <p className="slug">Signal lost</p>
          <h1 className="type-display mt-2 text-3xl">Something broke</h1>
          <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-relaxed text-slate">
            Your board is autosaved in this browser, so reloading should bring it back exactly as it
            was. If it happens again, the console holds the details — and a bug report would be very
            welcome.
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.reload()
              }}
              className="h-9 rounded-control bg-preview px-4 text-sm font-semibold text-room transition-[filter] hover:brightness-110"
            >
              Reload
            </button>
            <a
              href="https://github.com/micferna/rankroom/issues/new/choose"
              target="_blank"
              rel="noreferrer noopener"
              className="grid h-9 place-items-center rounded-control border border-edge px-4 text-sm text-chalk transition-colors hover:bg-rail"
            >
              Report it
            </a>
          </div>

          <pre className="type-mono mt-6 max-h-40 overflow-auto rounded-control border border-edge bg-desk p-3 text-left text-[10px] break-words whitespace-pre-wrap text-slate">
            {error.message || String(error)}
          </pre>
        </main>
      </div>
    )
  }
}
