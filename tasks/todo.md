# Todo: SPEC.md P0 + P1 (branch `feat/p0-p1-ebook-pipeline`)

Scope = SPEC §13 P0 + P1. P2/P3 NOT started. Decisions/deviations: `implementation-notes.md`.

## P0 cleanup
- [x] deps
- [x] delete listener routes, scrape route, store, old types, Podbean dialog/card
- [x] `migrations/` + runner
- [x] `lib/guarded-fetch.ts` (+ SSRF tests)
- [x] `lib/rss.ts` rewrite w/ fast-xml-parser, guid fallback, feed identity (+ tests)
- [x] Better Auth (Google only) + route guard helper
- [x] docs: README/CLAUDE.md de-Puppeteer (GO-MARKETING.md rewrite not reviewed by me)

## P1 slice
- [x] providers: `transcribe()` + `generate()` fake/real, env-selected
- [x] import API (RSS URL; Apple search is browser-side UI), attest log, English gate
- [x] select episodes + brief, create ebook
- [x] `advance` state machine + lease claim (+ race test)
- [x] transcribe stage (AssemblyAI poll, segments, delete vendor transcript)
- [x] outline stage (map/merge), approve API (UI pending)
- [x] draft stage + quote check (+ tests)
- [x] review API: edit, regenerate, undo, opened-all gate (UI pending)
- [x] PDF render route
- [x] UI pages: home/import, podcast, run, outline, review, export
- [x] rate limiter (in-memory)
- [x] Playwright e2e on fake providers
- [ ] lint + tsc + tests green; FOR-CARTER.md update

## Review
- tsc clean, vitest 97 pass, playwright e2e 1 pass.
- Not done: lint (no ESLint config; hook blocks it), real-provider smoke test, P2/P3.
