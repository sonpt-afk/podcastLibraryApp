import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pool, { query } from './db';
import {
  advance, approveOutline, editChapter, exportBlockers, getEbook, markOpened,
  regenerateAll, regenerateChapter, resolveAttention, undoChapter,
} from './pipeline';
import { fakeControl, resetFake } from './providers/fake';

// Real Postgres (TEST_DATABASE_URL, enforced by vitest.config.ts) + fake providers.

let ebookId: string;
let episodeIds: string[];

async function seed(episodes = 2) {
  await query(`truncate "user" cascade`);
  await query(`insert into "user" (id, name, email, "emailVerified") values ('u1', 'U', 'u@x.test', true)`);
  const p = await query<{ id: string }>(
    `insert into podcasts (user_id, feed_url, feed_identity, title) values ('u1', 'https://f.test/rss', 'fid', 'Pod') returning id`,
  );
  episodeIds = [];
  for (let i = 0; i < episodes; i++) {
    const e = await query<{ id: string }>(
      `insert into episodes (podcast_id, guid, title, audio_url) values ($1, $2, $3, $4) returning id`,
      [p.rows[0].id, `g${i}`, `Episode ${i}`, `https://cdn.test/${i}.mp3`],
    );
    episodeIds.push(e.rows[0].id);
  }
  const b = await query<{ id: string }>(
    `insert into ebooks (podcast_id, user_id, title, brief) values ($1, 'u1', 'Book', 'a book about newsletters') returning id`,
    [p.rows[0].id],
  );
  ebookId = b.rows[0].id;
  for (const [i, id] of episodeIds.entries()) {
    await query('insert into ebook_episodes (ebook_id, episode_id, position) values ($1, $2, $3)', [ebookId, id, i]);
  }
}

const status = async () => (await getEbook(ebookId)).status;

/** advance until `target`, with a safety bound */
async function runUntil(target: string, max = 30) {
  for (let i = 0; i < max && (await status()) !== target; i++) await advance(ebookId);
  expect(await status()).toBe(target);
}

async function toDrafting() {
  await runUntil('awaiting_outline');
  const { outline } = (await getEbook(ebookId)) as unknown as { outline: never };
  expect(await approveOutline(ebookId, outline)).toBe(true);
}

const chapters = async () =>
  (
    await query<{ id: string; markdown: string; status: string; opened: boolean; hand_edited: boolean }>(
      'select * from chapters where ebook_id = $1 order by chapter_no',
      [ebookId],
    )
  ).rows;

beforeEach(async () => {
  resetFake();
  await seed();
});
afterAll(() => pool.end());

describe('pipeline happy path', () => {
  it('transcribes, outlines, waits for approval, drafts, lands in review', async () => {
    await runUntil('awaiting_outline');

    const eps = await query<{ transcript: unknown[] }>('select transcript from episodes where id = any($1)', [episodeIds]);
    expect(eps.rows.every((r) => r.transcript.length === 10)).toBe(true);
    expect(fakeControl.removed).toHaveLength(2); // vendor transcripts deleted
    const jobs = await query('select assemblyai_id from transcription_jobs');
    expect(jobs.rows.every((r) => r.assemblyai_id === null)).toBe(true);

    const e = (await getEbook(ebookId)) as unknown as { outline: { sources: unknown[] }[]; omitted: Record<string, unknown[]> };
    expect(e.outline).toHaveLength(2); // two topics, each drawing on both Episodes
    expect(e.outline[0].sources).toHaveLength(2);
    expect(Object.keys(e.omitted)).toHaveLength(2); // ads/outro recorded per Episode

    expect(await chapters()).toHaveLength(0); // nothing drafted before approval
    await toDrafting();
    await runUntil('review');

    const ch = await chapters();
    expect(ch.map((c) => c.status)).toEqual(['done', 'done']);
    expect(ch[0].markdown).toMatch(/^# Growing the audience/);
  });

  it('approving twice is a no-op', async () => {
    await toDrafting();
    expect(await approveOutline(ebookId, [])).toBe(false);
    expect(await chapters()).toHaveLength(2);
  });

  it('rejects an outline referencing a foreign Episode', async () => {
    await runUntil('awaiting_outline');
    const bad = [{ title: 't', summary: 's', sources: [{ episodeId: '00000000-0000-0000-0000-000000000000', ranges: [] }] }];
    await expect(approveOutline(ebookId, bad)).rejects.toThrow(/outside this Ebook/);
    expect(await status()).toBe('awaiting_outline'); // tx rolled back
  });
});

describe('lease + races', () => {
  it('two concurrent advances draft a single pending chapter once', async () => {
    await toDrafting();
    await query(`update chapters set status = 'done' where chapter_no = 2`);
    fakeControl.draftCalls = 0;
    await Promise.all([advance(ebookId), advance(ebookId)]);
    expect(fakeControl.draftCalls).toBe(1);
  });

  it('does not re-claim finished chapters (old lease in the past)', async () => {
    await toDrafting();
    await runUntil('review');
    await query(`update chapters set lease_until = now() - interval '1 hour'`);
    fakeControl.draftCalls = 0;
    await advance(ebookId);
    expect(fakeControl.draftCalls).toBe(0);
  });

  it('re-claims a running chapter whose lease expired (crashed worker)', async () => {
    await toDrafting();
    await query(`update chapters set status = 'running', lease_until = now() - interval '1 second' where chapter_no = 1`);
    await query(`update chapters set status = 'done' where chapter_no = 2`);
    await advance(ebookId);
    expect((await chapters())[0].status).toBe('done');
  });
});

describe('fidelity + failures', () => {
  it('retries a hallucinated quote strictly and ends with grounded text', async () => {
    fakeControl.hallucinate = true;
    await toDrafting();
    await runUntil('review');
    const ch = await chapters();
    expect(ch.every((c) => !c.markdown.includes('triple revenue'))).toBe(true);
    expect(fakeControl.draftCalls).toBe(4); // 2 chapters x (draft + strict retry)
  });

  it('retries a transient draft failure, then succeeds', async () => {
    await toDrafting();
    fakeControl.transientDraftFailures = 1;
    await advance(ebookId);
    expect((await chapters())[0].status).toBe('pending');
    await runUntil('review');
  });

  it('fails a chapter after repeated transient errors but still reaches review', async () => {
    await toDrafting();
    fakeControl.transientDraftFailures = 3;
    await runUntil('review');
    const ch = await chapters();
    expect(ch[0].status).toBe('failed');
    expect(ch[1].status).toBe('done');
    expect(await regenerateChapter(ch[0].id)).toBe(true);
    await advance(ebookId);
    expect((await chapters())[0].status).toBe('done');
  });

  it('permanent transcription failure stops at needs_attention; drop continues with the rest', async () => {
    fakeControl.failTranscribe.add('https://cdn.test/1.mp3');
    await runUntil('needs_attention');
    const snap = await query('select attention_reason from ebooks where id = $1', [ebookId]);
    expect(snap.rows[0].attention_reason).toMatch(/Episode 1/);

    await resolveAttention(ebookId, 'drop', episodeIds[1]);
    await runUntil('awaiting_outline');
    const e = (await getEbook(ebookId)) as unknown as { outline: { sources: unknown[] }[] };
    expect(e.outline[0].sources).toHaveLength(1);
  });
});

describe('review actions', () => {
  beforeEach(async () => {
    await toDrafting();
    await runUntil('review');
  });

  it('bulk regenerate skips hand-edited chapters; single regenerate with instruction is allowed and undoable', async () => {
    const [c1, c2] = await chapters();
    expect(await editChapter(c1.id, '# mine\n\nmy words')).toBe(true);
    expect(await regenerateAll(ebookId)).toBe(1);
    await advance(ebookId);
    const after = await chapters();
    expect(after[0].markdown).toBe('# mine\n\nmy words');
    expect(after[1].markdown).toContain('# Pricing the paid tier');

    expect(await regenerateChapter(c2.id, 'make it punchier')).toBe(true);
    await advance(ebookId);
    const regen = (await chapters())[1];
    expect(regen.markdown).toContain('make it punchier');
    expect(await undoChapter(c2.id)).toBe(true);
    expect((await chapters())[1].markdown).not.toContain('make it punchier');
  });

  it('export is blocked until every chapter was opened', async () => {
    expect(await exportBlockers(ebookId)).toEqual({ unopened: 2, undone: 0 });
    for (const c of await chapters()) await markOpened(c.id);
    expect(await exportBlockers(ebookId)).toEqual({ unopened: 0, undone: 0 });
  });
});
