# CLAUDE.md

Guidance for Claude Code in this repo.

## Overview

Podcast → Ebook: a creator imports their own podcast's RSS feed, picks episodes, and a pipeline (AssemblyAI transcripts → OpenAI outline + chapters) produces a reviewable Ebook exported as PDF. Source of truth for behaviour: `docs/SPEC.md`. Decisions: `docs/adr/`. Domain terms: `CONTEXT.md` (Podcast, Episode, Ebook, Chapter, Creator…). Deviations from the spec: `implementation-notes.md`. Scope built: SPEC §13 P0 + P1.

## Commands

```bash
npm run dev | build | start | test | migrate
npx tsc --noEmit            # delete .next/ first if you see phantom type errors
```

- `.env` may have CRLF endings: `set -a; . <(tr -d '\r' < .env); set +a`.
- Run node-pg-migrate via `./node_modules/.bin/node-pg-migrate up -m migrations` (`npx` fails here).
- Tests hit a real Postgres at `TEST_DATABASE_URL` (must differ from `DATABASE_URL`; `vitest.config.ts` refuses otherwise) with fake providers. Files run serially. A suite that fails to load can be summarised as "PASS (0) FAIL (0)": zero tests is not green.
- No ESLint config is committed (a hook blocks creating `.eslintrc.json`); add `{"extends":"next/core-web-vitals"}` yourself to enable `npm run lint`.

## Architecture

- **API routes** (`app/api/`) are thin: `authed()` wrapper in `lib/api.ts` (401, `ServiceError` → status, else logged 500), zod body validation, ownership check, call into `lib/`. Next 15: `params` is a Promise.
- **`lib/pipeline.ts`**: `advance(ebookId)` is idempotent, one unit of work per call, driven by client polling (ADR-0001). Stages `queued → transcribing → outlining → awaiting_outline → drafting → review → exported`, plus `needs_attention`. Non-chapter stages hold `pg_try_advisory_lock`; chapters use a 90 s row lease claimed with `FOR UPDATE SKIP LOCKED` (expiry applies only to `status='running'`).
- **`lib/providers/`**: `Transcriber` and `Generator` interfaces; `fake` (canned, `fakeControl` knobs for tests), `assemblyai`, `openai`. Chosen per call by `TRANSCRIBE_PROVIDER` / `GENERATE_PROVIDER`. Real providers are untested against the live APIs.
- **Fidelity** (`lib/quote-check.ts`, ADR-0003): quotes must appear verbatim in the transcript; strict redraft once, then demote. Numbers/names not in the transcript are flagged. Export blocked until all chapters are done and opened.
- **`lib/guarded-fetch.ts`**: all outbound feed fetches go through it (DNS-time private-IP blocking, size/time/redirect caps).
- **DB**: plain `pg` Pool (`lib/db.ts`), raw SQL, snake_case columns; APIs alias to camelCase in SQL. Migrations are plain `.sql` with `-- Up Migration` / `-- Down Migration`. Auth tables use Better Auth's camelCase columns.
- **PDF** (`lib/pdf.tsx`): rendered on demand, never stored. Vitest needs `oxc.jsx.runtime = 'automatic'` because tsconfig has `jsx: preserve`.

## Conventions

- Feature branch only, never push to main; commit when a task completes.
- Run `npx tsc --noEmit` and tests after edits.
- Log any decision not in the spec in `implementation-notes.md`.
- Keep `FOR-CARTER.md` (plain-language project explainer) current.
