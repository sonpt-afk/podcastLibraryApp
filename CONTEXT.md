# Podcast-to-Ebook

A tool that lets podcast creators turn their own episodes into sellable ebooks. Creators import a podcast, pick episodes, review an AI-drafted ebook, and export it for sale elsewhere.

## Language

**Creator**:
A signed-in person who imports Podcasts and generates Ebooks from them.
_Avoid_: User, customer, podcaster

**Podcast**:
A feed-backed series a Creator imports, identified by its RSS feed.
_Avoid_: Show, channel, feed

**Episode**:
One published installment of a Podcast, with audio and, once processed, a transcript.
_Avoid_: Recording, track

**Ebook**:
The one deliverable the product makes: a short guide of Chapters built from one or more Episodes of a single Podcast.
_Avoid_: Product, book, guide, deliverable

**Chapter**:
One generated section of an Ebook, grounded in the transcripts of the Episodes behind it.
_Avoid_: Section, part

**Brief**:
A Creator's one-line statement of who an Ebook is for and what the reader should be able to do afterward.
_Avoid_: Prompt, instructions, requirements

**Outline**:
The ordered list of Chapter titles, each with a one-line summary, that the Creator approves before any Chapter is drafted.
_Avoid_: Table of contents, structure, plan

**Listing kit**:
The generated copy a Creator pastes into a storefront to sell an Ebook: title, description, tags, suggested price.
_Avoid_: Listing, Gumroad product, metadata

**Run**:
One execution that turns a Creator's selected Episodes into a draft Ebook, from transcription through drafting. It can pause for the Creator's attention when an Episode cannot be processed.
_Avoid_: Job, task, pipeline, generation

**Plan**:
The commercial level a Creator is on, Free or Pro, which sets their Quota.
_Avoid_: Tier, subscription, package

**Quota**:
The allowance of Ebooks and transcribed audio hours a Plan grants. Spent when transcription starts, except for audio that fails to transcribe.
_Avoid_: Limit, credits, usage cap

**Ownership attestation**:
A Creator's recorded claim, made at import, that they own or hold rights to a Podcast.
_Avoid_: Consent, agreement

**Ownership verification**:
Proof that a Creator controls a Podcast, established by a code sent to the owner email in its feed. Required before an Ebook can be exported.
_Avoid_: Authentication, validation
