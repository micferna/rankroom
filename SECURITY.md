# Security policy

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/micferna/rankroom/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and what an attacker could do with it. A proof of
concept — a crafted share link, a JSON payload, a channel name — is worth a great deal.

This is a personal project, so there is no formal SLA. Expect a first reply within a few
days, and credit in the advisory unless you would rather stay anonymous.

## What is in scope

RankRoom is a static site with no backend, no accounts and no server-side storage. That
removes whole classes of vulnerability, and concentrates the rest in a few places:

| Surface             | Why it matters                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/lib/schema.ts` | Parses share links, pasted JSON and stored records — all attacker-controlled — into the object the whole app trusts. |
| `src/lib/share.ts`  | Decodes and inflates untrusted input before it reaches the parser.                                                   |
| `src/lib/twitch.ts` | Reads messages from a public chat that anyone can post to.                                                           |
| `src/lib/crowd.ts`  | Turns those messages into votes shown on stream.                                                                     |
| `src/lib/image.ts`  | Decodes user files and re-encodes them into data URLs.                                                               |

Findings we would very much like to hear about:

- **Script execution from a share link.** An image value that is not inline raster data, a
  label that escapes its text node, anything that runs on load.
- **Prototype pollution** through a crafted id or key.
- **Rendering confusion** — bidi or control characters that make the UI or an exported
  image say something other than what the data says.
- **A malicious chat message** that breaks the vote parser, forges another viewer's vote,
  or moves a tile without the streamer accepting it.
- **Denial of service** from a payload that is small to send and expensive to parse.

## What is out of scope

- Anything requiring the attacker to already control the victim's browser or extensions.
- The bundled fonts and their upstream projects.
- Missing headers that GitHub Pages does not let a static site set.
- Reports from automated scanners with no demonstrated impact.

## What RankRoom already does

- Untrusted boards are whitelist-parsed: unknown keys dropped, every value re-derived,
  placement rebuilt from scratch.
- Tile images must match `data:image/(png|jpeg|webp|gif);base64,…`, which is what keeps a
  `javascript:` or `data:text/html` value out of `<img src>`.
- `__proto__`, `constructor` and `prototype` are rejected as ids.
- Control characters and bidi overrides are stripped from all text.
- Title, label, tier count, item count and image size are all capped.
- Uploaded images are re-encoded, which strips EXIF — including GPS coordinates that would
  otherwise travel inside a share link.
- The Twitch connection is anonymous and read-only. RankRoom holds no token and can never
  post to a channel.
- Dependencies are updated weekly by Dependabot, and CI fails on a high-severity advisory.

Each of these has tests in `src/lib/schema.test.ts`, `src/lib/crowd.test.ts` and
`src/lib/twitch.test.ts`.
