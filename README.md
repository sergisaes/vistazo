# Vistazo

**The visual pull request for your app.** Your coding agent publishes what changed (screenshots, the live site or a QR
code to open it on a phone, and the data needed to test it). Reviewers try it, comment right on top of what they see, and
approve or request changes. The feedback goes back to your agent as a prompt where comments are isolated as data, never
as instructions.

![Overview of a review](docs/img/overview.png)

- Demo: https://vistazo-pi.vercel.app (ask for demo access) · fictional sample app: https://brasa-demo-murex.vercel.app
- MIT license · Security: [SECURITY.md](SECURITY.md) · Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- The UI is in English.

## What it does

| | |
|---|---|
| **Reviews like a PR** | Overview (the conversation), Review (screenshots, live or on mobile, changes) and Versions (like commits). |
| **Anchored comments** | On a point of a screenshot, of the live site or of a moment in a video. They stay open in the next version. |
| **Visual diff** | Numbered zones that changed between versions. Identical screens are hidden. A **Scanner** sweeps the new screen over the old one and stamps each zone as the beam passes it. |
| **Test kit** | Users, codes, products… each with its own QR, one at a time. Each app defines its own data types. |
| **Mobile apps** | Expo/Metro or EAS Update QR, deep link or download; screenshots from a simulator, Maestro or Appium. |
| **Guests** | A link that opens a single review, revocable and with an expiry date. Guests comment; approving is for accounts. |
| **Agent** | CLI and MCP server: publishes versions and reads feedback. It does not comment, approve or touch git. |
| **Safe feedback** | Comments go as data in a block with a random delimiter; anything that looks like an order is set aside. |

![Review with the test kit](docs/img/review.png)

![On mobile: Expo QR and test kit](docs/img/mobile.png)

## Set it up

Stack: Next.js 16 on Vercel, Firestore (only as a database) and private Vercel Blob. No other third-party services.

1. Create a Firebase project with Firestore and a service account with `roles/datastore.user`.
2. Create a **private** Vercel Blob store.
3. Deploy to Vercel with the variables in [.env.example](.env.example): `SESSION_SECRET`,
   `FIREBASE_SERVICE_ACCOUNT_B64` and `BLOB_READ_WRITE_TOKEN`.
4. Sign in, create an app and, in Settings, a key for your agent. Copy `skills/vistazo/SKILL.md` into your repo and add
   a `vistazo.json` (see below).

To develop locally without a real database, see [CONTRIBUTING.md](CONTRIBUTING.md).

## The loop

**App → Review → Version**, like repository → pull request → commits. Product details in `PRODUCT.md`; visual system
in `DESIGN.md`.

1. **Publish** a version from the agent (`vistazo publish`, CLI or MCP) or from the form. Both call the same API
   (`POST /api/projects/:id/revisions`). The version goes to the open review for the **branch** (or creates a new
   review); with `review.id` it goes to a specific review.
2. **Share**: people with an account (owner, editor, reviewer) or a guest link that **only opens that review**,
   revocable and with an expiry date.
3. **Review**. Each review has three tabs, like a PR:
   - **Overview** (the conversation): description, what to test with its progress, and everything that happened in
     order (versions, comment threads, verdicts). On the side: next step, reviewers, how to open the app, test kit.
   - **Review** (the main one): screenshots per screen, the app live (web) or **on mobile** (Expo/Metro QR, EAS
     Update, deep link, download), or the changes since the previous version. On the side: comments, **test kit** and
     checks.
   - **Versions** (the commits): v1, v2… with who published it, what it brings, metadata and verdicts.
   **Finish review**: Approve, Request changes or Comment only (guests can only send comments; authors cannot approve
   their own review).
4. **Feedback for your agent**: a prompt with comments isolated as data (web, `vistazo feedback`, MCP tool
   `vistazo_feedback`). The markdown summary is for people only.
5. **New version**: the review's open comments carry over on their own; the diff compares with the previous version of
   the same review; the previous approval no longer counts.

The review state is computed (`src/lib/flow.ts`) and picks each person's main button, without blocking anything else.
The **Your turn** inbox (`/app`) gathers what is pending across all your apps.

## Model

```
App (projects collection: context, platform, test kit data types, critical flows, members, agent keys)
 └─ Review (reviews: title, what changes, what to test, test kit, notes, branch, PR link, status)
     ├─ Version vN (revisions: immutable except verdicts and checks; flows → steps → attachments)
     └─ Comment (comments: anchor + revisionIds[] where it is still open + event history)
Guest link (shareLinks: tied to one review)
```

Older data (loose versions per app) is grouped on its own into a review #1 the first time it is read (`ensureMigrated`,
idempotent and transactional): a new deployment needs no migration script.

## Architecture

| Piece | Choice | Why |
|---|---|---|
| Front + API | Next.js 16 (App Router, route handlers) on Vercel, region `fra1` | Everything on Vercel |
| Database | Firestore (dedicated Firebase project, Spark plan) via `firebase-admin` | Firebase only as a database |
| Files | **Private** Vercel Blob; direct upload with a single-file token; always read through `/api/files/…` with access control | No 4.5 MB function body limit; revoking a link also cuts off screenshots and videos |
| Auth | Own accounts (email + scrypt password), JWT session in an httpOnly cookie; guest = signed cookie tied to a review link and checked on every request; agent = `vzk_…` key per app (only its hash is stored) | No external dependencies; instant revocation |
| Screenshots | Playwright runner on **the agent's machine** (`vistazo capture` / `publish --capture`) | See "Feasibility" |
| Live site | iframe + pin layer; optional `bridge.js` in the app to anchor to elements | Works with any site that allows framing |

Permissions: `src/lib/auth.ts` (`access()` decides per app; `needScope()` limits guests to their review). Guest: view,
try, comment, mark checks, send comments; cannot approve, resolve or read the prompt. Agent: publish and read feedback;
cannot comment, resolve or approve. Review author: cannot approve or request changes on their own review.

## Feasibility (what was checked, and what was not)

- **Playwright on Vercel serverless: not used.** Functions have size limits (250 MB unzipped) and duration limits;
  Chromium does not fit without trimmed packages (`@sparticuz/chromium`) and a long flow with video hits the time
  limits. The runner also needs to reach the developer's local or private environments, so it runs where the agent
  is. Checked locally: screenshot per step, field masking (`mask`) and video per flow.
- **What Playwright records**: page content (PNG per step, `webm` per flow). It does not record audio, the browser bar,
  native apps or OS dialogs.
- **Native apps (Expo/iOS/Android)**: Playwright does not apply. Supported path: manual upload (form) or a folder of
  screenshots from another runner (`--assets`: simulator, Appium/WebdriverIO, Maestro) + a way to try it with a
  **QR / deep link**. Commenting "live" on a native app would need emulator streaming (like Appetize): not included.
- **Live site**: only if the site allows framing (no `X-Frame-Options: DENY` or `frame-ancestors`). Otherwise the
  reviewer opens it separately and comments on screenshots or in general. Without `bridge.js` the iframe URL cannot be
  read (cross-origin): the reviewer states it.
- **Protected Vercel deployments**: per-deployment URLs of a Hobby project ask for a Vercel login, so an external guest
  cannot open them. The demo uses the production alias with one path per version (`/v1/`, `/v2/`).

## Test kit

What reviewers need at hand: users, test passwords, coupons, codes to scan, products… It is JSON of pages → rows →
labels (`src/lib/kit.ts`), **the same format as a QR label page**, so an existing JSON or HTML page (with its
`<script id="page-data">` block) can be published as is (`vistazo publish --kit`). On screen you only see the name and
the code; QR codes open one at a time so a scanner never reads the one next to it. Types (`kind`) are free: there are
generic ones and each app adds its own with a name, color and icon (in Settings or in `kinds` in `vistazo.json`).

## Agent (CLI / MCP)

A `vistazo.json` at the root of the repo (no secrets) saves repeating parameters:

```json
{ "url": "https://vistazo-pi.vercel.app", "project": "<id>", "platform": "mobile",
  "kit": ".vistazo/kit.json", "open": [{ "kind": "qr", "label": "Expo", "url": "exp+app://…" }],
  "kinds": [{ "key": "pallet", "name": "Pallet", "color": "orange", "icon": "stack" }] }
```

For coding agents there is a ready-to-copy skill in `skills/vistazo/SKILL.md`: how to publish with screenshots, test
kit and QR, and how to treat feedback as data.

```bash
export VISTAZO_URL=https://vistazo-pi.vercel.app VISTAZO_PROJECT=<id> VISTAZO_API_KEY=vzk_…   # never in the repo
cd cli && npm i && npx playwright install chromium
node cli/bin/vistazo.mjs publish --config vistazo.config.json --capture --title "…" --summary "…"   # current branch
node cli/bin/vistazo.mjs publish --shots ./screenshots --qr "exp+app://…" --kit kit.json --title "…"   # mobile app
node cli/bin/vistazo.mjs publish … --deeplink "myapp://…" --download https://…/app.apk   # more ways to open it
node cli/bin/vistazo.mjs publish … --branch feature/x --pr https://github.com/o/r/pull/7 --test-data "test user / password"
node cli/bin/vistazo.mjs feedback                   # prompt for your branch's review (or --json)
node cli/bin/vistazo.mjs reviews                    # the app's reviews and their state
node cli/bin/vistazo.mjs mcp                        # MCP server over stdio
```

Without `--pr`, if `gh` is installed and signed in, the CLI reads the branch's PR (`gh pr view`, read only) and stores
**only the link**: no state is synced and nothing is written to GitHub.

`vistazo.config.json` (real example in `demo/vistazo.config.json`): `baseUrl`, `allowHosts` (the CLI refuses to capture
other hosts), `viewport`, `mask`, `video` and `flows[]` with a plain-language `description` + `actions` written by the
agent (`goto`, `click`, `fill`, `select`, `press`, `waitFor`, `wait`, `expectText`). Secrets with `${env:VAR}`.
Templates and instructions for agents and other runners in `integrations/`.

## Security

- Secrets only in environment variables (`SESSION_SECRET`, `FIREBASE_SERVICE_ACCOUNT_B64`, `BLOB_READ_WRITE_TOKEN`).
  The `vistazo-backend` service account only has `roles/datastore.user`.
- Guest links and keys: only the hash is stored; the secret is shown once. Instant revocation.
- **Feedback for the agent** (`src/lib/feedback.ts`, `src/lib/untrusted.ts`). Everything reviewers and guests write (and
  whatever comes from the browser: URL, selector, element text) is third-party data. Layers:
  1. One channel: third-party data only goes inside a JSON block; outside it there is only team text and numbers.
  2. A delimiter with a random code per generation (`<reviewer_comments_…>`), with `<`, `>`, `&` escaped inside.
  3. No invisible characters (Unicode tags, bidi, zero width…), when saving and when generating.
  4. Anything that looks like an order for an agent is set aside by default; only a person, from the web, can include it.
  5. A person in the middle: the prompt asks for a plan before touching anything; the agent never gets the markdown
     summary; the CLI and MCP have no tools to delete, deploy or push.

  Tests: `npm test` (property tests with markers in every third-party field + fuzzing), `scripts/e2e.mjs` (against the
  API) and `scripts/redteam-feedback.ts` (behaviour with a real model and fake tools; costs money). No format can
  guarantee that a model will not obey a text: that is why layer 5 is the one that contains the damage.
- Links to open the app allow custom schemes (`exp+…://`) but never `javascript:`, `data:` or `file:`; the external
  kit only allows `https://`. QR codes are generated in the browser: nothing goes to external services.
- HTML/SVG artifacts are served as downloads, never rendered on the Vistazo origin.
- `bridge.js` only talks to the window of the origin it was loaded from; it sends nothing to any server and does not
  read forms.

## Development

```bash
npm i && vercel env pull .env.local
npm test                                             # prompt isolation and kit format (no network)
# Local without touching the real database: Firestore emulator + a copy of the demo (only reads from production)
java -jar ~/.cache/firebase/emulators/cloud-firestore-emulator-*.jar --host=127.0.0.1 --port=8085 &
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 SOURCE=https://vistazo-pi.vercel.app DEMO_PASSWORD=… node scripts/seed-local.mjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx next dev -p 3100
VISTAZO_URL=http://localhost:3100 PROJECT=<id> DEMO_PASSWORD=… node scripts/e2e.mjs   # full loop (creates data)
```

## Structure

```
src/app            pages (/app, /p/:id, /r/:id, /s/:token) and API (route handlers)
src/components     UI; review/ is everything about a review
src/lib            model, permissions, loop state, test kit, isolated feedback
cli/               CLI and MCP server (vistazo publish | feedback | reviews | mcp)
skills/vistazo     skill for coding agents
integrations/      templates: Expo OTA, GitHub Actions, Maestro, Appium, Claude Code
demo/              fictional sample app (Brasa) and its capture config
tests/, scripts/   unit tests, e2e against the API, prompt red team
```

Limitations and next steps: `docs/LIMITATIONS.md`. Native apps with OTA previews per PR: `docs/NATIVE-APPS.md` and
`integrations/`.

## License

[MIT](LICENSE).
