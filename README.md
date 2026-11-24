# Podcast → Ebook

Turn a podcast you own into an Ebook (PDF). Import an RSS feed, pick episodes, and the app transcribes them, proposes a chapter outline, drafts the chapters from the transcripts, and exports a 6×9 PDF after you review every chapter.

Spec: [`docs/SPEC.md`](docs/SPEC.md) · Decisions: [`docs/adr/`](docs/adr) · Vocabulary: [`CONTEXT.md`](CONTEXT.md) · Deviations and gotchas: [`implementation-notes.md`](implementation-notes.md)

## Status

SPEC §13 **P0 + P1** (thin slice, Google sign-in, no payments). Not built yet: quotas, ownership verification, Polar billing, email/sweeper, listing kit, account deletion, EPUB. See `implementation-notes.md`.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind + shadcn/ui · TanStack Query · PostgreSQL via `pg` + `node-pg-migrate` · Better Auth (Google) · AssemblyAI (transcripts) · OpenAI (outline + chapters) · `@react-pdf/renderer` · Vitest · Playwright

## How it works

1. **Import**: paste an RSS URL (or search Apple Podcasts in the browser). Feeds are fetched through an SSRF-guarded fetch (`lib/guarded-fetch.ts`), English only. You attest you own the show.
2. **Create**: choose episodes (≤ 6 h audio) and write a one-line brief. One Ebook per podcast.
3. **Run**: the browser polls `POST /api/ebooks/:id/advance`; each call does one idempotent unit of work (transcribe → map → outline → draft). State lives in Postgres, so closing the tab is safe.
4. **Outline**: edit, reorder, delete chapters, then approve.
5. **Review**: every chapter must be opened before export. Quotes are checked verbatim against the transcript; ungrounded quotes are redrafted, then demoted to plain text. Numbers and names not in the transcript are flagged.
6. **Export**: PDF rendered on demand, never stored.

## Setup

```bash
npm install
cp .env.example .env            # fill in values
createdb podcast_ebook && createdb podcast_ebook_test
npm run migrate                 # dev DB
DATABASE_URL=<test db url> npm run migrate
npm run dev                     # http://localhost:3000
```

Set `TRANSCRIBE_PROVIDER=fake` and `GENERATE_PROVIDER=fake` to run the whole pipeline on canned data for free. `real` needs `ASSEMBLYAI_API_KEY` / `OPENAI_API_KEY`. Google sign-in needs `GOOGLE_CLIENT_ID/SECRET` and redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`.

## Commands

```bash
npm run dev | build | start     # start also runs pending migrations
npm run migrate                 # node-pg-migrate up
npm test                        # vitest (needs TEST_DATABASE_URL, a DIFFERENT database: tests truncate tables)
npx tsc --noEmit
```

## Layout

```
app/api/            thin route handlers (auth check → lib/)
app/                pages: import, podcast, ebook (run / outline / review / export)
lib/pipeline.ts     advance() state machine, leases, review actions
lib/providers/      Transcriber / Generator interfaces; fake, assemblyai, openai
lib/quote-check.ts  verbatim-quote fidelity check
lib/ebooks.ts       import + create + ownership helpers
lib/pdf.tsx         PDF renderer
migrations/         plain .sql (Up/Down) for node-pg-migrate
```
