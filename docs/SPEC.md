# Podcast-to-Ebook — Spec

Status: draft v2, 2026-11-24 (v2: §18 resolved with verified prices). Supersedes `majestic-crafting-yao-plan.md` (kept as history). Glossary: `CONTEXT.md`. Decisions: `docs/adr/`.

## 1. Product

Creator imports own Podcast (RSS), picks 1–N Episodes, AI drafts Ebook (15–25 pp), Creator reviews/edits, exports PDF + Listing kit, sells elsewhere (Gumroad etc.). One deliverable only (ADR-0004).

Revenue: Pro subscription via Polar (merchant of record). No transaction fee, no sales tracking, no Gumroad integration in MVP.

## 2. Scope

**In:** RSS/Apple import, auth, attestation, transcription, Outline approval, Chapter drafting, Markdown editor, PDF, Listing kit, ownership verification gate on export, guest checklist, Plans/Quota, Polar billing, sweeper, deletion.

**Out (MVP):** email course/social/template/blog products, Gumroad API push, EPUB, non-English, multiple templates, cover editor, listener features (favorites/ratings/hashtags), Zustand/localStorage store, Puppeteer/Podbean scraping, Pandoc/LaTeX, Vercel/Blob, transcript cache, Deepgram.

## 3. Stack

| Concern | Choice |
|---|---|
| App | Next.js 15 App Router, React 19, TS strict, Tailwind v3, shadcn/ui (existing) |
| Client data | TanStack Query (already installed; polling `advance`/status). Zustand removed |
| DB | Neon free (100 CU-hrs/mo, 1 GB, scale-to-zero after 5 min idle), pooled URL, plain `pg` Pool (raw SQL, snake_case → camelCase in API) |
| Migrations | `node-pg-migrate`, plain `.sql` in `migrations/`, run at container start |
| Auth | Better Auth on existing Pool: Google OAuth (P1); + emailed one-time code via Resend (P2, once domain bought) |
| Email | Resend free (3k/mo, 100/day; needs verified domain): login code, ownership code, "draft ready". P2 |
| Transcription | AssemblyAI `assemblyai-stt-3-7` (set explicitly; free-tier default differs), speaker labels on; submit `<enclosure>` URL; poll from `advance` |
| LLM | OpenAI behind `generate(task)`: `gpt-6-luna` for map/merge, `gpt-6.1-terra` for Chapter prose; Flex tier; model names in env; OpenAI project budget $10/mo |
| Search | Apple iTunes Search API called **from the browser** (`access-control-allow-origin: *`); server only receives the chosen `feedUrl` |
| PDF | `@react-pdf/renderer` (or pdfkit), Markdown AST → components, rendered on demand |
| Billing | Polar checkout + portal + webhook → `subscriptions` |
| Host | Railway Hobby ($5/mo incl. $5 usage; Free plan sleeps), single always-on container (ADR-0002); usage limit $10 |
| RSS parse | XML library (e.g. `fast-xml-parser`), not regex |

## 4. Data model (sketch)

- Better Auth tables (generated SQL as one migration).
- `podcasts`: id, user_id, feed_url, feed_identity (normalized hash), title, art_url, language, owner_email, attested_at, verified_at.
- `consent_log`: user_id, podcast_id, kind (`attest`|`guest_export`), text_version, at, ip.
- `ownership_codes`: podcast_id, code_hash, expires_at (15 min), attempts (≤5).
- `episodes`: id, podcast_id, guid, title, audio_url, duration_s, published_at, transcript jsonb (segments `{id, speaker, start_ms, text}`), `UNIQUE(podcast_id, guid)`. guid fallback = sha1(enclosure URL + title).
- `transcription_jobs`: episode_id, assemblyai_id, status, audio_hours_charged.
- `ebooks`: id, podcast_id, user_id, title, brief, status (stage), outline jsonb, exported_at.
- `ebook_episodes`: ebook_id, episode_id, position.
- `chapters`: id, ebook_id, chapter_no, title, summary, segment_ranges jsonb, markdown, prev_markdown (1 undo slot), hand_edited bool, status, lease_until, attempts, `UNIQUE(ebook_id, chapter_no)`.
- `usage`: per-user period counters (ebooks started, audio hours); `feed_usage`: per `feed_identity` free audio hours.
- `subscriptions`: user_id, polar ids, status, plan, current_period_end.

Existing prototype rows: wiped.

## 5. Pipeline (Run)

Stages: `queued → transcribing → outlining → awaiting_outline → drafting → review → exported`; side state `needs_attention`.

1. **Import**: RSS URL or Apple search (browser calls iTunes Search directly, debounced; picks `feedUrl`; no server proxy, so no shared-IP rate limit). Non-`en` feed language blocked ("English only for now", notify-me). Attest checkbox logged. Full feed fetched once; list newest-first.
2. **Select**: 1–N Episodes of one Podcast; cap **6 audio hours** per Ebook. Optional one-line Brief (prefilled from feed description).
3. **Transcribe**: quota charged at start. Store `assemblyai_id`; `advance` polls. On complete: copy transcript into Postgres, split to numbered segments, **DELETE vendor transcript**. Audio never stored by us.
4. **Outline**: per-Episode map pass (topics + segment ranges; rubric drops ads/sponsor reads, intros/outros, housekeeping, banter; records omitted list per Episode), then merge pass → Outline. Run stops at `awaiting_outline`: Creator reorders/renames/deletes Chapters, approves.
5. **Draft**: one LLM call per Chapter; input = only its assigned segments. Quote check (§6).
6. **Review**: Markdown editor (§9). Export blocked until every Chapter opened.
7. **Export**: needs Ownership verification + guest-content checkbox (if flagged). Streams freshly rendered PDF. Listing kit generated on request.

`advance` (`POST /api/ebooks/[id]/advance`): idempotent, one unit of work per call. Chapter claim:
`UPDATE chapters SET status='running', lease_until=now()+interval '90s' WHERE id=$1 AND (status='pending' OR lease_until<now()) RETURNING *`.
Callers: open tab (React Query loop) and sweeper (in-process interval, ~5 min, calls same function for expired leases; also `/api/cron/advance` secret-guarded). Completion → "draft ready" email. Container must never sleep. See ADR-0001.

**Sweeper must not keep Neon awake**: a 5-min query matches Neon's 5-min suspend → DB never sleeps → 0.25 CU × 730 h ≈ 182 CU-hrs > 100 free (exhausted ~day 16). Gate it: in-memory `maybeStuck` flag, `true` on boot and whenever `advance` leaves a Run non-terminal; sweeper skips the DB while `false`; a sweep that finds nothing sets it `false`. Same rule for any health check: never touch the DB.

Failures: transient (5xx/timeouts) auto-retry 2× with backoff. Permanent (403/404, >duration cap, unsupported) stop only that Episode → `needs_attention`: drop & continue / swap / cancel. Charged only for audio actually transcribed; cancel keeps paid transcripts. Chapter regeneration is free; re-transcription is not.

## 6. Fidelity (ADR-0003)

- Chapter sees only assigned segments.
- Any text in quotes must fuzzy-match (normalize case/punct/smart quotes) a substring of those segments; fail → retry once → demote to unquoted paraphrase.
- Numbers/names/proper nouns not in segments flagged in editor.
- Markdown in DB = only source of truth; PDF never stored.
- Hand-edited Chapters locked from bulk regenerate. Regenerate takes optional instruction; prior text kept in 1 undo slot.

## 7. Ownership, guests, legal

- **Attest to generate** (logged), **verify to export**: 6-digit code to `<itunes:owner><itunes:email>` via Resend; masked/missing email → **feed-token check**: we show a token (e.g. `pte-verify-7F3K9Q`), Creator pastes it into the show description at their host, clicks "Check", we re-fetch the feed (guarded fetch, bypass cache) and look for it; token expires 72 h; Creator may remove it after success. No manual review.
- Guests: diarization; Chapters with >~30% non-host speech get "Guest content" badge; export requires logged checkbox "I have permission to publish guest content"; guest names attributable or anonymized per Chapter. ToS puts clearance duty on Creator.
- **Founder demo/outreach samples**: admin-only flag (logged) bypasses attestation; 1 Chapter only, watermarked "SAMPLE – prepared for <Podcast>", sent only to feed owner email, never public; transcript + sample deleted after 14 days unless they sign up.
- Need: ToS, privacy page, takedown contact. Generator template before Phase 2 (Polar review expects them); register a US DMCA designated agent; lawyer review after first revenue.

## 8. Plans, quota, billing

COGS (prices verified 2026-11-24, standard tier unless noted):

| Item | Rate | Per unit |
|---|---|---|
| Transcription | STT-3.7 $0.21/hr + speaker labels $0.02/hr | **$0.23/audio hr** |
| LLM map/merge | `gpt-6-luna` $0.10 in / $0.50 out per 1M (Flex: half) | ~$0.015 per 6-hr Ebook |
| LLM Chapters | `gpt-6.1-terra` $1 in / $5 out per 1M (Flex: half) | ~$0.23 per 6-hr Ebook (~8 Chapters, +10% retries) |
| Polar Starter | 5% + 50¢, +1.5% non-US card | ~$1.74 per $19 charge |
| Polar payout | $2/mo active + 0.25% + 25¢ per payout, ≤1% FX to VND | ~$2.5/mo |
| Fixed | Railway Hobby ~$5–8, domain ~$1, Neon/Resend free | ~$7/mo → 1 Pro sub breaks even |

Unit economics: Free Ebook (2 h) ≈ $0.56 once per feed. Pro worst case (20 h, 10 Ebooks) = 19 − 4.60 − ~2 LLM − 1.74 = **$10.66 (56%)**; typical (5 h) ≈ $15.60 (82%). Polar Pro plan ($20/mo, 3.8% + 40¢) pays off only at ~61 subs.

Starting credit: AssemblyAI $50 signup (≈217 hrs); OpenAI $4 (≈16 Ebooks standard, ≈30 Flex) covers the Phase 1 gate.

| | Free | Pro $19/mo |
|---|---|---|
| Ebooks | **1 per feed, lifetime** | 10/mo |
| Audio hours | ≤2 for that one Ebook | 20/mo |
| PDF | "Made with <product>" footer | no footer |

Numbers fixed for launch; revisit with Phase 1 data. No "unlimited". Free Ebook keyed to `feed_identity` so many accounts on same feed share it (never resets). Global daily transcription-spend circuit breaker pauses new Free starts. Quota consumed at transcription start.

Polar webhook events → `subscriptions` (subscribed/renewed/canceled), code only against those three so provider is swappable.

## 9. UX

- Podcast page: Episode list (search/sort), multi-select, "Create Ebook".
- Run page: stage stepper, per-Episode status, honest "safe to close this tab; we'll email you". Paused/needs-attention states explicit.
- Outline editor: reorder/rename/delete, approve.
- Review: per-Chapter Markdown textarea + live preview (reuse PDF AST renderer), Regenerate (+instruction), Undo, badges (guest, unverified numbers), omitted-passages list per Episode.
- Export: verification prompt, guest checklist, PDF, Listing kit (title, description, tags, suggested price) + link to Gumroad new-product page. Suggested price = fixed bands by page count (<20 pp $9, 20–30 $15, >30 $19), no LLM call.
- PDF: one template, 6×9 in, serif body, cover from feed art (fetched via guarded fetch), TOC, Chapter openers, pull-quotes; Creator edits title/subtitle/author/accent color; one Latin font family embedded.
- Empty/error states for every list and stage; delete Podcast / delete account = hard cascade.

## 10. Security & abuse

- **Guarded fetch helper** for every outbound fetch (feed, art; iTunes is browser-side): https only; resolve DNS, reject private/loopback/link-local/metadata ranges; connect to resolved IP; manual redirects ≤3 with re-check; 10 s timeout; 5 MB cap; content-type check.
- Rate limits: Better Auth built-in for auth routes; ~25-line in-memory sliding window by userId/IP on import, search, send-code, run-start (e.g. 10 imports/hr, 5 code sends/hr per feed, 20/day per user). `ponytail:` resets on restart; move to Postgres counters if a 2nd instance appears.
- Free-tier farming: quota per feed identity + global daily spend breaker.
- Secrets in env only; sweeper endpoint secret-guarded; LLM free tiers not used for creator data.

## 11. Privacy & retention

Delete AssemblyAI transcript right after copying; disable their training use. LLM calls on no-training/zero-retention terms. We keep transcripts until Podcast/account deleted (cascade). Audio never stored. Privacy page states exactly this.

## 12. Testing

Fake `transcribe()`/`generate()` (env-selected; canned transcript, deterministic chapters, injectable failures). Vitest + real Postgres (docker compose or Neon branch): lease race (2 concurrent `advance`), quota math, quote check, SSRF guard, feed identity/guid fallback. One Playwright e2e: sign in → import fixture feed → run → edit → PDF. Manual real-provider smoke script before release.

## 13. Build order & gate

- **P0 cleanup** (feature branch): delete listener routes/store/scrape/Puppeteer text; migrations; Better Auth; RSS rewrite; guarded fetch.
- **P1 thin slice (~3 wks)**: import (RSS + Apple), Google-only auth, attestation, transcribe, outline+Brief+approve, draft+quote check, editor, PDF, fake providers, tests. Runs on `*.up.railway.app`. No billing/verification/sweeper/email/domain.
- **Before outreach**: pick name, buy domain, verify it in Resend.
- **Gate**: 5 hand-picked Creators; ≥3 export an Ebook they'd sell AND ≥2 say they'd pay $19.
- **P2 (only after gate)**: quotas, ownership verification, guest checklist, Polar, sweeper + email, Listing kit, Free footer, deletion, ToS/privacy.
- **P3 (evidence-led)**: EPUB, Gumroad draft push (`POST /v2/products`, `edit_products`), more languages, other products.

Go-to-market (reconciles `GO-MARKETING.md`): build slice while doing Reddit-help phase (no pitch); then outreach to ~20 podcasters (1K–10K downloads) with owner-only sample (§7) + Loom. Rewrite `GO-MARKETING.md` claims to Ebook-only; drop "5 products", "50-page", "17 minutes", unverified stats. Claude drafts the rewrite in P0; founder edits voice.

## 14. Repo changes

Delete: `app/api/episodes/[id]/{favorite,rating,hashtags}`, `app/api/podcasts/scrape`, `lib/store.ts`, Podbean regex in `components/add-podcast-dialog.tsx`, stale Puppeteer text in `README.md`/`CLAUDE.md`/`AGENTS.md`. Replace `scripts/init-db.sql` with `migrations/`. Keep shadcn UI, `QueryProvider`, `lib/db.ts`. Update `CLAUDE.md` after P0. Follow `.claude/rules/vc.md` (feature branches, no push to main, diagnostics clean).

## 15. Plan errors fixed

"Creator keeps 95%" vs Gumroad 10% + 5% (fee dropped); 5 vs 3 vs 4 product types (now 1); stale 2024 Gantt; one-time free credits treated as monthly ("618 hrs/month" wrong); Groq `llama-3.3-70b-versatile` past shutdown (08/16/26); free tiers for production creator data; Pandoc/LaTeX on serverless; Gumroad API "can't create products" (it can; deferred). v2: AssemblyAI "185 free hrs" stale (it's $50 credit); transcription $0.17 → $0.23/hr; `gpt-5-mini` shuts down 2026-12-11 (don't use); Polar fee is 5% + 50¢ (not 4% + 40¢) for new accounts.

## 16. Risks

Closed tab + no sweeper = stalled Runs; invented content in sellable Ebook; free-quota farming; SSRF via feed URLs; guest/IP complaints; Polar first-payout review (up to 14 days); Neon cold starts, 1 GB cap and CU-hour burn (§5); OpenAI model churn (pin names in env, watch deprecations page); solo-founder focus split between build and distribution.

## 17. ADRs

0001 client-driven pipeline + sweeper · 0002 single container on Railway · 0003 quote check + on-demand PDF · 0004 Ebook-only scope.

## 18. Resolved questions (v2) and what's left

| # | Question | Answer |
|---|---|---|
| 1 | LLM | OpenAI `gpt-6-luna` map/merge + `gpt-6.1-terra` Chapters, Flex tier, $10/mo budget (§3, §8) |
| 2 | AssemblyAI | $50 signup credit, no card; STT-3.7 $0.21/hr + $0.02/hr speaker labels |
| 3 | Polar | 5% + 50¢ (+1.5% intl); Vietnam on payout list (local bank, VND); AUP allows SaaS/eBooks; first payout review ≤14 days |
| 4 | Free/Pro | Free = 1 Ebook per feed lifetime, ≤2 h; Pro = 10 Ebooks / 20 h per month |
| 5 | Masked email | Feed-token check, no manual review (§7) |
| 6 | Suggested price | Page-count bands, no LLM (§9) |
| 7 | Name/domain | Deferred; P1 Google-only on `*.up.railway.app`; buy before outreach |
| 8 | Legal text | Template now, DMCA agent, lawyer after revenue |
| 9 | 6 h cap | Kept |
| 10 | Apple search | Browser-side call; no proxy needed |
| 11 | `GO-MARKETING.md` | Claude drafts in P0, founder edits |
| 12 | Sweeper/Railway | 5 min, DB-gated by `maybeStuck` (§5); Railway Hobby, $10 usage limit |

Still open: product name + domain (before outreach); re-check OpenAI deprecations page before P1 coding.
