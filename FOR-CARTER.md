# FOR-CARTER: The Podcast-to-Ebook Project, Explained Like a Human

*Last updated 2026-11-24. Companion docs: `docs/SPEC.md` (the blueprint), `CONTEXT.md` (the dictionary), `docs/adr/` (the "why we did it this way" notes).*

## The one-paragraph version

Podcasters pour hours into episodes, then watch them evaporate into feeds. This project turns a podcaster's own episodes into a **sellable ebook**: import the show, pick a few episodes, an AI listens (transcribes) and drafts a 15–25 page guide, the podcaster edits it, downloads a PDF, and sells it somewhere like Gumroad. We make money from a $19/month Pro plan.

## Where we started (and why it matters)

The repo began life as a *listener's* app: a personal podcast library where you paste a Podbean link, a headless browser (Puppeteer) scrapes the page, and you can favorite episodes, rate them and add hashtags. Think of it as a bookshelf for podcasts you love. (Puppeteer was already swapped for RSS parsing in an earlier commit; some docs still describe the old way.)

Then a very different plan appeared (`majestic-crafting-yao-plan.md`): a business tool for *creators*. Same word, "podcast", completely different customer. The big early decision was **evolve this repo into the creator tool and delete the bookshelf features**. That's like converting a bookstore into a print shop: keep the building (Next.js, Postgres, UI kit), rip out the shelves.

## The architecture, as a restaurant

- **The dining room** (`app/`, `components/`): Next.js + React + Tailwind + shadcn/ui. What Creators see.
- **The kitchen** (API routes + a Postgres database on Neon): where orders are tracked. Postgres is the *only* memory. If it isn't in the database, it didn't happen.
- **The delivery drivers** (outside services): AssemblyAI turns audio into text, an LLM writes prose, Resend sends emails, Polar takes payments. We rent them; we don't build them.
- **The expediter** (the `advance` route): a very simple loop that says "what's the next unfinished step for this order? do exactly one step, write the result down, repeat." Every step is safe to run twice, so if two callers (a browser tab and a background timer) shout "advance!" at once, nothing breaks.

A **Run** is one order moving through the kitchen: transcribe → outline → *you approve the outline* → draft chapters → *you review* → export.

## The decisions, and the "why" behind each

| Decision | Why (in plain words) |
|---|---|
| **Ebook only** | The original plan promised five products. Each is a separate product to build and prove. One thing done well beats five half-done. (ADR-0004) |
| **Any RSS feed + Apple search** | Podbean-only meant ignoring most of the world. RSS is the universal podcast format, so one importer covers nearly everyone. |
| **Postgres as a state machine, no job queue** | Fewer moving parts. A job-queue service is a whole extra thing to learn, pay for and debug. Cost: work only progresses while someone is "pushing" it, so a small timer (the *sweeper*) also pushes. (ADR-0001) |
| **Lease compare-and-set** | A "lease" is like writing your name on a whiteboard: "I'm working on Chapter 3 until 2:05." If you crash, the lease expires and someone else can take over. The database makes the check-and-claim a single atomic move, so two workers can't both grab it. |
| **PDF rendered on demand** | Store the text, never the PDF. Like keeping the recipe instead of the cooked meal: it can never be stale, and deleting a Creator's data is one `DELETE`. (ADR-0003) |
| **Railway container, not Vercel** | Serverless functions are like taxi rides: great for short trips, awful when the job takes a minute. Chapter and PDF calls run 20–60 seconds, and the sweeper needs a machine that never sleeps. Vercel's free tier also forbids commercial use. (ADR-0002) |
| **Better Auth** | Google sign-in plus emailed one-time codes, running on the same Postgres connection we already have. No second database for users. |
| **Polar (merchant of record)** | They legally sell on our behalf, so global sales tax/VAT is their headache, not ours. We pay a few percent for that. |
| **English only** | Every language multiplies testing: fonts, quoting rules, ad detection. Start narrow. |
| **Free quota per *feed*, not per account** | Accounts are free to create; podcasts aren't. Tying free hours to the feed stops someone making 50 accounts to farm free transcription. |

## The scariest problem: the AI making things up

If the AI invents a quote and attributes it to a podcaster's guest, and the podcaster sells that, we've built a lawsuit generator. Our defense is mechanical, not hopeful:

1. Split every transcript into numbered segments.
2. Give each chapter *only* its segments, never the whole show.
3. Anything in quotation marks must be found (nearly) word for word in those segments, checked by code. If it's not, we retry once, then strip the quotation marks.
4. The Creator must open every chapter before export.

**Lesson:** when "please don't hallucinate" is the only protection, you have no protection. Put a checker in code.

## The security lessons baked into the design

- **SSRF**: we fetch URLs that strangers type in. A malicious "feed URL" could point at our own internal network. One guarded fetch function (https only, block private IP ranges, connect to the resolved IP, limit redirects/size/time) is the only way the app touches the internet. A blocklist of strings like `localhost` is the classic wrong answer: attackers use decimal IPs, IPv6, redirects, and DNS tricks.
- **Free-tier farming**: anything free gets abused. Plan for it before launch, not after.
- **Mail bombing**: an endpoint that sends emails on demand is a weapon pointed at someone's inbox. Rate-limit it.
- **Owner proof**: we send a code to the email *inside the podcast's own feed*. If you can read that inbox, you control the show.

## Bugs and surprises we hit (so you don't repeat them)

1. **The plan disagreed with itself.** It said "creator keeps 95%" and also "Gumroad 10% + our 5% on top"; it listed 5, 3 and 4 product types in different sections. *Lesson: read a plan like a proofreader hunting contradictions before building on it.*
2. **Free credits aren't monthly income.** The plan treated one-time credits as monthly resets ("618 hours a month"). *Lesson: check whether a free tier is a one-time gift or a recurring allowance; costs hide there.*
3. **A model was already scheduled to die.** The plan's chosen free LLM (`llama-3.3-70b-versatile` on Groq) has a shutdown date of 08/16/26. *Lesson: dated facts rot fast; verify provider pricing, limits and deprecations the week you build.*
4. **We were wrong about Gumroad too.** I believed its API couldn't create products; it can (`POST /v2/products`). *Lesson: when you're guessing about a third party, look it up. Being corrected cheaply now beats rebuilding later.*
5. **`ON CONFLICT DO NOTHING` with nothing to conflict on.** `app/api/podcasts/[id]/episodes/route.ts` inserts episodes with a bare `ON CONFLICT DO NOTHING`, but the episodes table has no unique key, so the clause never fires and re-syncing a feed can insert duplicates. *Lesson: a safety net must actually be attached. The fix is `UNIQUE(podcast_id, guid)` in the new schema.*
6. **Regex "parsing" XML.** `lib/rss.ts` reads feeds with regexes. Feeds in the wild are messy: CDATA, namespaces, odd encodings. *Lesson: use a real parser (e.g. `fast-xml-parser`) for structured formats.*
7. **A "safe" model was 17 days from death.** The obvious cheap pick, `gpt-5-mini`, is on OpenAI's deprecations page with a 2026-12-11 shutdown. We chose `gpt-6-luna` + `gpt-6.1-terra` and keep model names in env vars. *Lesson: before you choose a model, read the provider's deprecations page, not just its pricing page.*
8. **The watchdog that eats the free tier.** A sweeper that queries the DB every 5 minutes matches Neon's 5-minute sleep timer exactly, so the database never sleeps: about 182 compute-hours a month against 100 free, gone by about day 16. Fix: the sweeper only touches the DB while an in-memory "something might be stuck" flag is set. *Lesson: on scale-to-zero services, every timer is a bill. Ask "does this wake something up?"*
9. **The proxy we didn't need.** We planned a server proxy for Apple podcast search, which would put every user's searches behind one IP (rate limit of about 20/min) and add one more URL-fetching surface. One `curl -I` showed iTunes sends `access-control-allow-origin: *`, so the browser calls it directly. *Lesson: check the headers before building plumbing.*
10. **Prices drift in both directions.** Transcription was $0.17/hr in our notes; the current speech model plus speaker labels is $0.23/hr. Polar's fee for new accounts is 5% + 50¢, not the 4% + 40¢ quoted elsewhere. *Lesson: put "verified on <date>" next to every price.*

## How good engineers worked here

- **Interview before building.** About 40 pointed questions were resolved *before* any code, because a wrong decision on paper costs a sentence and in code costs a week.
- **Smallest slice that can fail.** Phase 1 is a thin slice with five real Creators and a pass/fail gate ("3 of 5 export an ebook they'd sell, 2 say they'd pay $19"). Billing, verification and emails wait until the idea proves itself.
- **Fake the expensive parts in tests.** Real AssemblyAI/LLM calls cost money and are slow and flaky. Tests use fake versions of both, and a real Postgres to test the actual race conditions.
- **Write down the "why".** `docs/adr/` has four short notes so future-you doesn't "fix" something that was deliberate (like moving the deploy back to Vercel).
- **Cost math before pricing.** Transcription costs $0.23 per audio hour. A worst-case Pro user (20 hours, 10 ebooks) costs about $4.60 for audio, about $2 for AI and $1.74 in Polar fees, so we keep about $10.66 of the $19 (56%). A typical user leaves about $15.60. Each feed gets one free ebook, ever (about $0.56). Fixed costs are about $7/month, so the first paying user covers the servers.
- **Spend the cheap model where it's cheap.** Summarizing transcripts (the "map" step) runs on the small model (`gpt-6-luna`, $0.10 per 1M tokens in). Only the prose the Creator actually reads goes to the bigger one (`gpt-6.1-terra`). Background jobs use the "Flex" tier, which costs half in exchange for slower answers. Your $4 of OpenAI credit covers about 30 ebooks.
- **Be honest about what's unverified, then verify it.** v1 of the spec listed 12 open questions. v2 answered them with prices checked on 2026-11-24 and cited sources. Only the product name and domain are still open.

## New technologies in this project (what they are)

- **RSS**: the plain-text "table of contents" every podcast publishes.
- **Merchant of record**: a company that is legally the seller, handling tax and refunds for you.
- **Diarization**: transcription that labels *who* spoke (host vs guest).
- **State machine**: a thing that is always in exactly one named state and moves only along allowed arrows.
- **Lease / compare-and-set**: claim-then-expire locking done inside the database.
- **TanStack Query**: a library for fetching and polling server data in React.
- **node-pg-migrate**: versioned SQL files that evolve the database safely.

## Lessons from building the thin slice

**Zero tests is not green.** A test runner that says "PASS (0) FAIL (0)" can mean the suite failed to load at all. Ours did: Next needs `jsx: preserve` in tsconfig, Vitest then could not parse `.tsx`. Think of a smoke alarm that is silent because the battery is out. Always check the *count*.

**Stale generated files lie.** After deleting old routes, `tsc` reported 12 phantom errors, because `.next/types` still pointed at them. Delete the build cache before trusting a type error.

**Security by construction beats security by checking.** The SSRF guard checks the IP inside the socket's DNS lookup, so the address it validated is the address it connects to. A "resolve, check, then connect" design lets an attacker swap the answer in between (DNS rebinding). The price: a localhost test server can never pass, so the e2e test uses a flagged fixture instead.

**Specs have bugs too.** The spec's chapter lease claim (`pending OR lease expired`) would have re-claimed *finished* chapters, because their old lease is in the past. Writing the race test first exposed it.

**Guard your test database.** Tests wipe tables, so `vitest.config.ts` refuses to run unless `TEST_DATABASE_URL` differs from `DATABASE_URL`. One wrong env var is how people delete production.

**A slow test is not a hung test.** The PDF route "hung" in e2e. I blamed react-pdf and changed config, then called the route directly: 200 in 15 s. The real problem was a 2-minute budget against cold `next dev` compiles. Measure before you theorise, and revert the fix for a bug you did not have.

**Hand-off bugs hide at seams.** The UI subagent found that "drop episode" returned a 500 because the API needed an id the UI could not know. Each side was fine alone.

**Tooling friction is data.** A hook blocked `.eslintrc.json`, so lint is still unconfigured. I did not bypass it; I logged it for you.

## Where the project is right now

P0 and P1 are built on branch `feat/p0-p1-ebook-pipeline`: RSS import, transcript and chapter pipeline on fake providers, quote check, review UI, and PDF export. `tsc` is clean, 97 unit tests and one Playwright end-to-end run pass. Not done: the real AssemblyAI and OpenAI providers have never touched the live APIs (smoke-test them with your $4 of credit), lint config, and everything in P2/P3 (quotas, ownership check, billing, listing kit). Open: product name and domain.
