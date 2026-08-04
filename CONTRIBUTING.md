# Contributing to RankRoom

Thanks for being here. Issues, ideas and pull requests are all welcome.

## Getting set up

```bash
npm install
npm run dev      # http://localhost:5173
```

Node 20.19 or newer. There is no backend, no database and no environment file — if it runs
`npm install`, it runs RankRoom.

Before opening a pull request:

```bash
npm run check    # format, lint, types, tests, build — the same order CI runs it
```

## How the code is organised

| Where             | What belongs there                                                 |
| ----------------- | ------------------------------------------------------------------ |
| `src/lib/`        | Pure domain logic. No React. Tested.                               |
| `src/store/`      | zustand stores — the only place state changes.                     |
| `src/components/` | Reusable UI and the board itself.                                  |
| `src/features/`   | One folder per mode and per dialog.                                |
| `src/i18n/`       | `en.ts` is the source of truth; `fr.ts` is typed against it.       |
| `build/`          | Build-time tooling: the service worker plugin, the icon generator. |

The one rule worth stating: **components do not reimplement domain logic**. If a
calculation matters, it lives in `src/lib`, has a test, and runs without a DOM.
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why each piece is shaped the way it is.

## What a good change looks like

- **Tests for logic.** Anything in `src/lib/` or `src/store/` should come with tests. Aim
  at behaviour, not implementation: "a tie places the newcomer below its rival" reads
  better in six months than "calls place() with mid + 1".
- **Both languages.** Every user-visible string goes through `t()` and exists in both
  `src/i18n/en.ts` and `src/i18n/fr.ts`. TypeScript enforces the second half.
- **Phone first, then desktop.** A tier list is mostly read, so tiles should be small and
  numerous. If a control only appears on hover, it does not exist on a phone.
- **Keyboard reachable.** Every action needs a focus ring and a keyboard path. The board
  supports keyboard drag and drop; keep it that way.
- **No new dependency without a reason.** RankRoom has three runtime dependencies beyond
  React. The icon set, the canvas renderer, the service worker and the share codec are all
  first-party because each was smaller than the library that would have replaced it. If a
  dependency genuinely earns its place, say so in the pull request.

## Commit messages

Short, imperative, and about the change rather than the file: `fix ghost tiles surviving a
tier deletion` beats `update crowd.ts`. Conventional Commit prefixes are welcome but not
required.

## Reporting bugs

Use the [issue templates](https://github.com/micferna/rankroom/issues/new/choose). Boards
never leave your browser, so nobody can see what you saw — concrete steps matter.

For anything security-related, see [SECURITY.md](SECURITY.md) instead. Please do not open a
public issue.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
