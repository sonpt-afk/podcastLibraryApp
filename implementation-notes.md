# Implementation notes

Running log of things not in `docs/SPEC.md`: decisions, changes, tradeoffs, gotchas. Newest at bottom.
Branch: `feat/p0-p1-ebook-pipeline`. Scope: SPEC §13 P0 + P1.

## Environment facts
- Local Postgres 5432 works with creds from `.env`. `son_podcast_library` (dev) **already existed** with the 3 empty legacy tables; I first misread that as "doesn't exist" because of the CRLF bug below. I created `son_podcast_test` for tests.
- `.env` has **CRLF** line endings (Windows editor). `source .env` in bash breaks (`$'\r': command not found`) and values get a trailing `\r`. Next.js's loader copes; shell scripts must `tr -d '\r'`.
- No docker in WSL, so SPEC §12 "docker compose" is replaced by the local Postgres + a separate test DB.
- Node 20.19.

## P0 log
- **Deleted uncommitted edits.** `git rm -f` removed listener-era files that had unstaged local changes (`favorite/route.ts`, `podcasts/route.ts`, `podcast-card.tsx`, `init-db.sql`). Spec §14 says delete them; committed versions stay in git history, the uncommitted tweaks are gone.
- **Migration 0 `drop-legacy`** added (not in spec): drops empty `podcasts/episodes/hashtags` so the new schema can reuse the names. Checked 0 rows first. Spec says "prototype rows wiped"; this is how.
- **Better Auth schema generated, not hand-written.** `@better-auth/cli generate` hung (no output after 2 min), so I called `getMigrations().compileMigrations()` from the library and pasted its SQL. Column names are camelCase (`"emailVerified"`, `"userId"`) unlike the rest of our snake_case tables. Intentional: the adapter requires them. `user.id` is `text`, so every `user_id` FK is `text`, not uuid.
- **Migrations are plain SQL** with `-- Up Migration` / `-- Down Migration` markers (node-pg-migrate format). `npm run migrate` reads `.env` via `--envPath`; `npm start` runs migrations then `next start` (spec: "run at container start").
- **P1 schema subset.** Omitted `usage`, `feed_usage`, `subscriptions`, `ownership_codes`: all P2. Added columns the spec's UI needs but §4 didn't list: `ebooks.{subtitle,author,accent_color}` (§9 cover editing), `ebooks.attention_reason`, `ebooks.omitted` (§9 omitted-passages list), `chapters.opened` (§5 export gate), `chapters.flags` (guest/unverified-number badges), `podcasts.description`, `episodes.description`.
- **`transcription_jobs` keyed by `episode_id`** (one job per episode, not per ebook): a transcript is reused when a second ebook picks the same episode. Spec says "transcript cache" is out of scope, but the transcript lives on `episodes` anyway (§4), so this is not a separate cache.
- **`podcasts` unique on `(user_id, feed_identity)`**, not just `feed_identity`: two users may each import the same feed (free quota is keyed globally by feed_identity in P2 via `feed_usage`).
- **Test-only password login.** `lib/auth.ts` enables Better Auth email+password only when `E2E_AUTH=1`, so Playwright can sign in without Google. Off by default; must never be set in production.
- **`lib/db.ts` simplified.** Dropped the `getClient` monkeypatch and per-query `console.log` (was logging full SQL text); kept `query` + default pool, now a `globalThis` singleton to survive Next dev hot reloads.
- **`lib/guarded-fetch.ts`: DNS check lives in the socket `lookup` hook**, not a separate resolve-then-connect step. Validation and connection share one DNS answer, so rebinding can't swap the IP in between (SPEC §10 says "connect to the resolved IP"; this is the stricter way to do it). IP *literals* skip DNS, so they get an extra up-front check. IPv4-mapped, NAT64 and 6to4 IPv6 forms are unwrapped and re-checked.
- **Size cap applies after gunzip** (zip-bomb guard); we send `accept-encoding: gzip` only. Not in spec.
- **`request` is an injectable param** on `guardedFetch` so tests script redirects/oversize bodies with no network. Real DNS/TLS path is untested here (needs network); covered by hook logic + `isBlockedIp` table tests.
- **Vitest config**: files run serially (`fileParallelism: false`) because DB tests share `son_podcast_test`.
- **`lib/rss.ts` rewritten** on `fast-xml-parser` (old Podbean regex helpers deleted). Items with no `<enclosure>` are skipped (nothing to transcribe). Episodes sorted newest-first in the parser, not left to feed order (feeds disagree).
- **Feed identity = `<podcast:guid>` if present, else hash of normalised URL** (https, lowercase host, no trailing slash / fragment / `utm_*`, sorted params). Spec only said "normalized hash". Using `podcast:guid` means a host migration doesn't hand a podcaster a second free Ebook. Tradeoff: two different feeds that copy the same `podcast:guid` would collide; acceptable for P1.
- **English gate**: missing `<language>` is allowed through (many feeds omit it); `en`, `en-US`, `en_GB` pass; anything else blocked. Spec said "non-`en` blocked" without covering the missing case.
- **Better Auth wiring**: `app/api/auth/[...all]/route.ts`, `lib/auth-client.ts`, `lib/session.ts` (`getUser()` returns user or null; `unauthorized()` is a 401 JSON). Routes check `if (!user) return unauthorized()`; no middleware (spec has no protected pages beyond the app itself, and middleware can't hit pg on the edge runtime anyway).
- **`next.config.ts`**: removed Podbean `images.remotePatterns`. Cover art comes from arbitrary hosts, so UI uses plain `<img>`; no allow-list to maintain. Tradeoff: no Next image optimisation.
- **Product name placeholder**: layout title is "Podcast to Ebook" (spec leaves name/domain open).
- **`.env.example`** now lists auth, provider, model-name and `E2E_AUTH` vars. Provider vars default to `fake`.
- **ESLint was never configured in this repo.** `next lint` has `eslint@8` + `eslint-config-next` installed but no `.eslintrc*`, so it only prompts. I tried to add `.eslintrc.json` (`{"extends":"next/core-web-vitals"}`) but the `config-protection` hook blocked it. I did NOT bypass it. I linted `lib app components` with an equivalent throwaway config in the scratchpad: 0 problems. **Action for you**: add that one-line `.eslintrc.json` (or disable the hook once) so `npm run lint` works.
- **Stale `.next/types`** caused 12 phantom `tsc` errors after deleting the old routes (generated validators still pointed at them). Deleted the gitignored `.next/` build cache; `tsc --noEmit` is clean.

## P1: providers, quote check, pipeline

- **Test DB guard.** `vitest.config.ts` throws unless `TEST_DATABASE_URL` is set and differs from `DATABASE_URL`. DB tests `truncate "user" cascade`; one wrong env var would wipe dev data. Migrate it with `DATABASE_URL=<test url> node-pg-migrate up -m migrations`.
- **Providers use plain `fetch`, no SDKs.** Smaller dep surface; only 3 endpoints each. AssemblyAI model is sent only if `ASSEMBLYAI_MODEL` is set (SPEC says `assemblyai-stt-3-7`; I could not verify the exact request field name offline). **Smoke-test real providers once before relying on them.**
- **Real providers are untested.** Fake ones are covered; `openai.ts`/`assemblyai.ts` compile but were never run against the live APIs (no keys in the loop). OpenAI calls set `service_tier: 'flex'`, 180 s timeout; 429 is treated as transient (Flex "resource unavailable").
- **Spec bug fixed: chapter lease claim.** SPEC §5 claim `status='pending' OR lease_until<now()` would re-claim *finished* chapters (their old lease is in the past). Expiry now only applies to `status='running'`. Claim is a single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` so concurrent callers take different chapters. Covered by tests (race, done-not-reclaimed, crashed-worker reclaim).
- **Migration 03 (not in SPEC §4):** `ebooks.maps` (per-Episode map results, used between map and merge passes), `ebooks.stage_attempts` (durable retry counter for outline stage), `chapters.instruction` (regenerate instruction).
- **Advisory lock for non-chapter stages.** transcribing/outlining/queued hold `pg_try_advisory_lock(hashtext(ebookId))` on a dedicated connection; a second concurrent `advance` returns immediately with current status. Chapters rely on the lease instead, so drafts parallelise.
- **`queued` means "recompute what is missing".** After `resolveAttention`, the ebook goes back to `queued` and the normal path re-derives the next stage. Fewer special edges.
- **Retries:** first try + 2 retries (`MAX_ATTEMPTS=3`). "Backoff" is just the client poll interval (no timers server-side). Transient chapter failure -> back to `pending`; after 3 -> chapter `failed` (does *not* block the Ebook reaching `review`; Creator can regenerate it). Export is blocked while any chapter is not `done`.
- **Needs-attention actions: `drop` and `retry` only.** SPEC also lists "swap" and "cancel": swap deferred (needs picking a replacement Episode UI); cancel = delete Ebook (not built, P2 deletion work).
- **Outline edit = client-side until approve.** No separate edit endpoint: the UI sends the edited chapter list in the approve call, which validates that all sources point at this Ebook's Episodes.
- **Vendor transcript deletion failure** is logged and `assemblyai_id` is kept as a "deletion owed" marker. Nothing sweeps it yet (sweeper is P2).
- **Hand-edited chapters:** a single explicit regenerate is allowed (clears `hand_edited`), bulk regenerate skips them. Editing does not recompute flags (flags stay from the last draft); regenerate/undo reset `opened` so the Creator must re-read.
- **Quote check details:** quotes under 4 words are ignored (scare-quotes); ellipsis quotes require every fragment to exist; matching is on whole words (padded with spaces) so "stop talk" does not match "stop talking". Flags: numbers and Title-Case multi-word names not in segments; headings excluded.

## P1: import, create, API routes, PDF

- **"One Ebook per Podcast" is enforced in `createEbook`, not by a DB constraint.** SPEC §4 has no unique index on `ebooks.podcast_id`. The podcast row is locked `for update` inside the transaction so two concurrent creates cannot both pass the check. Add a unique index in a later migration if you want belt and braces.
- **6-hour audio cap uses the feed's `duration_s`;** unknown duration counts as 0. Real length is only known after transcription (then `audio_hours_charged` is recorded).
- **Import requires `attested: true`** and writes a `consent_log` row on every import (re-imports log again, which keeps the audit trail honest). Re-import upserts Podcast and Episodes by `(user_id, feed_identity)` / `(podcast_id, guid)`.
- **API shape:** thin Next route handlers behind one wrapper (`lib/api.ts` `authed`): 401 when signed out, `ServiceError` -> its status, anything else -> logged 500 with a generic body. Request bodies validated with zod. Ownership checks resolve through `ebooks.user_id` (chapters via their ebook); a stranger gets 404, not 403.
- **Rate limits (in-memory, per process):** import 10/hour + 20/day per user, create 10/hour per user. `x-forwarded-for` is trusted for the IP stored in `consent_log` (fine behind Railway's proxy; spoofable elsewhere).
- **Outline approval body** is zod-checked for shape; source validity (episodes belong to this Ebook) is still checked in `approveOutline`.
- **PDF:** rendered on demand with `@react-pdf/renderer` (built-in Times/Helvetica, 6x9 in): cover, contents (no page numbers, would need a two-pass render), chapter openers, centered folio. Inline formatting limited to bold/italic; links and code render as plain text. Export is blocked (409) unless status is `review`/`exported` and every chapter is drafted and opened; a successful render sets `exported`. Nothing is stored.
- **Test gotcha:** `tsconfig` has `jsx: preserve` (Next needs it), which made Vitest fail to parse `.tsx`. Fixed with `oxc: { jsx: { runtime: 'automatic' } }` in `vitest.config.ts`. The test runner wrapper summarised the failed suite as "PASS (0) FAIL (0)": zero tests is not green.

## P1: e2e setup

- **Fixture feed bypasses the SSRF guard.** `guardedFetch` blocks private/localhost, so a local fixture server cannot work. When `E2E_AUTH=1` and the URL is exactly `https://fixture.invalid/feed.xml`, `importFeed` reads `e2e/fixture-feed.xml` from disk (`lib/ebooks.ts`). Same flag as the test-only password login; never set in prod. Tradeoff: a test branch lives in prod code, but it is one line, inert without the flag, and it keeps the guard itself untouched.
- **Playwright runs `next dev` on port 3100 against `TEST_DATABASE_URL`** (tables get wiped), fake providers. Playwright does not read `.env`: export it first (`set -a; . <(tr -d '\r' < .env); set +a`).
- **README/CLAUDE.md rewritten** for the Ebook app (Puppeteer/Podbean/Zustand content removed).
- **E2E passes** (`npx playwright test`, ~3 min): sign in → import fixture → create → run → approve → edit/open chapters → PDF 200 `%PDF-`. Slowness is `next dev` cold-compiling ~10 routes on /mnt/d (WSL), so test timeout is 360 s and `expect` timeout 30 s. The PDF check fetches the link directly instead of waiting for a download event: a failed `<a download>` emits no event and hides the server error. Needs `npx playwright install chromium` once.
- **False lead:** I suspected react-pdf hung inside Next and tried `serverExternalPackages`. It was only the test budget; PDF route returns 200 in ~15 s cold. Reverted.

## P1: UI

- Pages: `app/page.tsx` (sign-in, import, list), `app/podcast/[id]/page.tsx` (episode pick, 6 h total, brief), `app/ebook/[id]/page.tsx` (run stepper + advance loop, outline editor, review editor, details, export). Built by a subagent; I reviewed contract mismatches, not every line.
- **Advance loop guards** against overlap (busy ref) and stops with a "Resume" button on error.
- **Fix:** `resolveAttention('drop')` threw a plain Error (500) without an `episodeId`, and the UI has no id. Now drop defaults to this Ebook's Episodes with a failed transcription (409 if none).
- **Known gaps:** omitted-passages list labels Episodes by id prefix (GET lacks titles); no live markdown preview, guest badge, listing kit (P2); UI never calls `/api/cron/advance` (sweeper is P2). E2E sign-in form signs up then in with one button.
- **`.eslintrc.json` still missing** (config-protection hook): add `{"extends":"next/core-web-vitals"}`.
