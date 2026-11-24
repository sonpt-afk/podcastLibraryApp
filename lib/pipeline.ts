import pool, { query } from './db';
import { ServiceError } from './ebooks';
import { getGenerator, getTranscriber } from './providers';
import { ProviderError } from './providers/types';
import type { MapResult, OutlineChapter, Range, Segment } from './providers/types';
import { demoteQuotes, flagUnverified, ungroundedQuotes } from './quote-check';

// SPEC §5. `advance` is idempotent: one unit of work per call, safe to call from many tabs at once.
// Non-chapter stages hold a per-ebook advisory lock; chapters use a row lease so drafts can run in parallel.

const MAX_ATTEMPTS = 3; // first try + 2 retries; "backoff" = the client's poll interval
const LEASE = '90 seconds';

type Stage = 'queued' | 'transcribing' | 'outlining' | 'awaiting_outline' | 'drafting' | 'review' | 'exported' | 'needs_attention';

interface EbookRow {
  id: string;
  status: Stage;
  brief: string;
  maps: Record<string, MapResult>;
  stage_attempts: number;
}

interface ChapterRow {
  id: string;
  ebook_id: string;
  title: string;
  summary: string;
  segment_ranges: { episodeId: string; ranges: Range[] }[];
  instruction: string | null;
  attempts: number;
}

export async function getEbook(id: string) {
  const { rows } = await query<EbookRow>('select * from ebooks where id = $1', [id]);
  return rows[0];
}

const setStatus = (id: string, from: Stage, to: Stage) =>
  query(`update ebooks set status = $3, attention_reason = null, stage_attempts = 0 where id = $1 and status = $2`, [id, from, to]);

async function attention(id: string, reason: string) {
  await query(`update ebooks set status = 'needs_attention', attention_reason = $2 where id = $1`, [id, reason]);
}

/** Count a failed unit; escalate to needs_attention once retries are spent or the error is permanent. */
async function stageFailure(id: string, err: unknown, what: string) {
  const permanent = err instanceof ProviderError && err.permanent;
  const msg = err instanceof Error ? err.message : String(err);
  const { rows } = await query<{ stage_attempts: number }>(
    'update ebooks set stage_attempts = stage_attempts + 1 where id = $1 returning stage_attempts',
    [id],
  );
  if (permanent || rows[0].stage_attempts >= MAX_ATTEMPTS) await attention(id, `${what}: ${msg}`);
}

async function withLock(id: string, fn: () => Promise<void>) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [id]);
    if (!rows[0].ok) return; // another advance is mid-stage; caller just polls again
    try {
      await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [id]);
    }
  } finally {
    client.release();
  }
}

export async function advance(ebookId: string) {
  const e = await getEbook(ebookId);
  if (!e) throw new Error('ebook not found');
  switch (e.status) {
    case 'queued':
      await withLock(ebookId, () => stageQueued(ebookId));
      break;
    case 'transcribing':
      await withLock(ebookId, () => stageTranscribe(ebookId));
      break;
    case 'outlining':
      await withLock(ebookId, () => stageOutline(e));
      break;
    case 'drafting':
    case 'review':
    case 'exported': // review-stage regenerations also run here
      await stageDraft(e);
      break;
  }
  return snapshot(ebookId);
}

/** "queued" = recompute what is missing. Also the re-entry point after resolveAttention. */
async function stageQueued(id: string) {
  await query(
    `insert into transcription_jobs (episode_id)
       select e.id from ebook_episodes ee join episodes e on e.id = ee.episode_id
       where ee.ebook_id = $1 and e.transcript is null
     on conflict do nothing`,
    [id],
  );
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from ebook_episodes ee join episodes e on e.id = ee.episode_id
     where ee.ebook_id = $1 and e.transcript is null`,
    [id],
  );
  await setStatus(id, 'queued', rows[0].n ? 'transcribing' : 'outlining');
}

interface JobRow {
  episode_id: string;
  assemblyai_id: string | null;
  attempts: number;
  audio_url: string;
  title: string;
}

async function stageTranscribe(id: string) {
  const { rows: jobs } = await query<JobRow>(
    `select j.episode_id, j.assemblyai_id, j.attempts, e.audio_url, e.title
       from transcription_jobs j
       join episodes e on e.id = j.episode_id
       join ebook_episodes ee on ee.episode_id = e.id
      where ee.ebook_id = $1 and j.status = 'submitted' order by ee.position`,
    [id],
  );
  if (!jobs.length) {
    await setStatus(id, 'transcribing', 'outlining');
    return;
  }
  const t = await getTranscriber();
  for (const j of jobs) {
    try {
      if (!j.assemblyai_id) {
        const vendorId = await t.submit(j.audio_url);
        await query('update transcription_jobs set assemblyai_id = $2 where episode_id = $1', [j.episode_id, vendorId]);
        continue;
      }
      const r = await t.poll(j.assemblyai_id);
      if (r.status === 'processing') continue;
      if (r.status === 'failed') throw new ProviderError(r.error, r.permanent);
      await query(
        `update episodes set transcript = $2, duration_s = coalesce(nullif($3::int, 0), duration_s) where id = $1`,
        [j.episode_id, JSON.stringify(r.segments), r.durationS],
      );
      await query(
        `update transcription_jobs set status = 'completed', audio_hours_charged = $2, error = null where episode_id = $1`,
        [j.episode_id, r.durationS / 3600],
      );
      try {
        await t.remove(j.assemblyai_id); // SPEC §5.3: vendor copy deleted as soon as ours is stored
        await query('update transcription_jobs set assemblyai_id = null where episode_id = $1', [j.episode_id]);
      } catch (err) {
        // assemblyai_id stays set = "deletion still owed" marker for a later sweep
        console.error('vendor transcript delete failed', j.assemblyai_id, err);
      }
    } catch (err) {
      const permanent = err instanceof ProviderError && err.permanent;
      const attempts = j.attempts + 1;
      const msg = err instanceof Error ? err.message : String(err);
      await query('update transcription_jobs set attempts = $2, error = $3 where episode_id = $1', [j.episode_id, attempts, msg]);
      if (permanent || attempts >= MAX_ATTEMPTS) {
        await query(`update transcription_jobs set status = 'failed' where episode_id = $1`, [j.episode_id]);
        await attention(id, `Episode "${j.title}" could not be transcribed: ${msg}`);
        return; // stop this Episode's siblings from being touched until the Creator decides
      }
    }
  }
}

async function stageOutline(e: EbookRow) {
  const { rows: eps } = await query<{ id: string; title: string; transcript: Segment[] }>(
    `select e.id, e.title, e.transcript from ebook_episodes ee join episodes e on e.id = ee.episode_id
      where ee.ebook_id = $1 order by ee.position`,
    [e.id],
  );
  const g = await getGenerator();
  const next = eps.find((x) => !e.maps[x.id]);
  try {
    if (next) {
      const m = await g.mapEpisode({ title: next.title, segments: next.transcript });
      await query(
        `update ebooks set maps = maps || jsonb_build_object($2::text, $3::jsonb), stage_attempts = 0
          where id = $1 and status = 'outlining'`,
        [e.id, next.id, JSON.stringify(m)],
      );
      return;
    }
    const outline = await g.mergeOutline({
      brief: e.brief,
      episodes: eps.map((x) => ({ episodeId: x.id, title: x.title, topics: e.maps[x.id].topics })),
    });
    const omitted = Object.fromEntries(Object.entries(e.maps).map(([k, v]) => [k, v.omitted]));
    await query(
      `update ebooks set outline = $2, omitted = $3, status = 'awaiting_outline', stage_attempts = 0
        where id = $1 and status = 'outlining'`,
      [e.id, JSON.stringify(outline), JSON.stringify(omitted)],
    );
  } catch (err) {
    await stageFailure(e.id, err, 'Outline failed');
  }
}

/** Creator approves (possibly edited) outline: creates Chapter rows, starts drafting. False if already approved. */
export async function approveOutline(ebookId: string, chapters: OutlineChapter[]) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ok = await client.query(
      `update ebooks set outline = $2, status = 'drafting', stage_attempts = 0
        where id = $1 and status = 'awaiting_outline' returning id`,
      [ebookId, JSON.stringify(chapters)],
    );
    if (!ok.rowCount) {
      await client.query('rollback');
      return false;
    }
    const { rows: eps } = await client.query('select episode_id from ebook_episodes where ebook_id = $1', [ebookId]);
    const allowed = new Set(eps.map((r) => r.episode_id));
    for (const [i, c] of chapters.entries()) {
      if (c.sources.some((s) => !allowed.has(s.episodeId))) throw new Error('chapter references an Episode outside this Ebook');
      await client.query(
        `insert into chapters (ebook_id, chapter_no, title, summary, segment_ranges) values ($1, $2, $3, $4, $5)`,
        [ebookId, i + 1, c.title, c.summary, JSON.stringify(c.sources)],
      );
    }
    await client.query('commit');
    return true;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

// Spec's claim (`status='pending' OR lease_until<now()`) would also re-claim finished chapters (their old lease is in the past).
// Expiry only applies to rows still marked running. SKIP LOCKED lets concurrent callers take different chapters.
const CLAIM = `
  update chapters set status = 'running', lease_until = now() + interval '${LEASE}'
   where id = (
     select id from chapters
      where ebook_id = $1 and (status = 'pending' or (status = 'running' and lease_until < now()))
      order by chapter_no limit 1 for update skip locked)
  returning *`;

export async function chapterSegments(ch: Pick<ChapterRow, 'segment_ranges'>): Promise<Segment[]> {
  const out: Segment[] = [];
  for (const src of ch.segment_ranges) {
    const { rows } = await query<{ transcript: Segment[] }>('select transcript from episodes where id = $1', [src.episodeId]);
    const t = rows[0]?.transcript ?? [];
    out.push(...t.filter((s) => src.ranges.some((r) => s.id >= r.from && s.id <= r.to)));
  }
  return out;
}

async function maybeFinishDrafting(id: string) {
  await query(
    `update ebooks set status = 'review'
      where id = $1 and status = 'drafting'
        and not exists (select 1 from chapters where ebook_id = $1 and status in ('pending', 'running'))`,
    [id],
  );
}

async function stageDraft(e: EbookRow) {
  const { rows } = await query<ChapterRow>(CLAIM, [e.id]);
  const ch = rows[0];
  if (!ch) return maybeFinishDrafting(e.id);
  try {
    const segments = await chapterSegments(ch);
    const g = await getGenerator();
    const input = { title: ch.title, summary: ch.summary, brief: e.brief, segments, instruction: ch.instruction ?? undefined };
    // ADR-0003: quotes must be grounded. Retry once with quotes forbidden, then demote whatever is still ungrounded.
    let md = await g.draftChapter(input);
    let bad = ungroundedQuotes(md, segments);
    if (bad.length) {
      md = await g.draftChapter({ ...input, strict: true });
      bad = ungroundedQuotes(md, segments);
      if (bad.length) md = demoteQuotes(md, bad);
    }
    await query(
      `update chapters set markdown = $2, flags = $3, status = 'done', lease_until = null, attempts = 0,
              opened = false, hand_edited = false
        where id = $1 and status = 'running'`,
      [ch.id, md, JSON.stringify(flagUnverified(md, segments))],
    );
  } catch (err) {
    const permanent = err instanceof ProviderError && err.permanent;
    await query(
      `update chapters set attempts = attempts + 1, lease_until = null,
              status = case when $2 or attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end
        where id = $1`,
      [ch.id, permanent],
    );
  }
  await maybeFinishDrafting(e.id);
}

// ---- review actions -------------------------------------------------------------------------

/** Regenerate one Chapter (explicit, so allowed even if hand-edited). Previous text goes to the undo slot. */
export async function regenerateChapter(chapterId: string, instruction?: string) {
  const { rowCount } = await query(
    `update chapters set prev_markdown = case when markdown = '' then prev_markdown else markdown end,
            status = 'pending', attempts = 0, instruction = $2
      where id = $1 and status in ('done', 'failed')`,
    [chapterId, instruction?.trim() || null],
  );
  return !!rowCount;
}

/** Bulk regenerate: hand-edited Chapters are locked (SPEC §6). */
export async function regenerateAll(ebookId: string) {
  const { rowCount } = await query(
    `update chapters set prev_markdown = case when markdown = '' then prev_markdown else markdown end,
            status = 'pending', attempts = 0, instruction = null
      where ebook_id = $1 and not hand_edited and status in ('done', 'failed')`,
    [ebookId],
  );
  return rowCount ?? 0;
}

export async function undoChapter(chapterId: string) {
  const { rowCount } = await query(
    `update chapters set markdown = prev_markdown, prev_markdown = markdown, opened = false
      where id = $1 and status = 'done' and prev_markdown is not null`,
    [chapterId],
  );
  return !!rowCount;
}

export async function editChapter(chapterId: string, markdown: string) {
  const { rowCount } = await query(
    `update chapters set markdown = $2, hand_edited = true where id = $1 and status = 'done'`,
    [chapterId, markdown],
  );
  return !!rowCount;
}

export const markOpened = (chapterId: string) => query('update chapters set opened = true where id = $1', [chapterId]);

/** SPEC §5.6: export blocked until every Chapter was opened (and drafted). */
export async function exportBlockers(ebookId: string) {
  const { rows } = await query<{ unopened: number; undone: number }>(
    `select count(*) filter (where not opened)::int as unopened, count(*) filter (where status <> 'done')::int as undone
       from chapters where ebook_id = $1`,
    [ebookId],
  );
  return rows[0];
}

// ---- needs_attention ------------------------------------------------------------------------

/** drop: remove the failing Episode and continue. retry: re-run what failed (re-transcription is paid again). */
export async function resolveAttention(ebookId: string, action: 'drop' | 'retry', episodeId?: string) {
  if (action === 'drop') {
    // No id given (the UI has none): drop whichever Episodes of this Ebook have a failed transcription.
    const ids = episodeId
      ? [episodeId]
      : (
          await query<{ episode_id: string }>(
            `select tj.episode_id from transcription_jobs tj
               join ebook_episodes ee on ee.episode_id = tj.episode_id
              where ee.ebook_id = $1 and tj.status = 'failed'`,
            [ebookId],
          )
        ).rows.map((r) => r.episode_id);
    if (!ids.length) throw new ServiceError('Nothing to drop: no failed Episode found.', 409);
    for (const id of ids) {
      await query('delete from ebook_episodes where ebook_id = $1 and episode_id = $2', [ebookId, id]);
      await query(`delete from transcription_jobs where episode_id = $1 and status <> 'completed'`, [id]);
      await query('update ebooks set maps = maps - $2::text where id = $1', [ebookId, id]);
    }
  } else {
    await query(
      `update transcription_jobs set status = 'submitted', attempts = 0, assemblyai_id = null, error = null
        where status = 'failed' and episode_id in (select episode_id from ebook_episodes where ebook_id = $1)`,
      [ebookId],
    );
  }
  await setStatus(ebookId, 'needs_attention', 'queued');
}

// ---- progress for the UI --------------------------------------------------------------------

export async function snapshot(ebookId: string) {
  const { rows } = await query(
    `select e.id, e.status, e.attention_reason as "attentionReason",
            (select count(*)::int from ebook_episodes where ebook_id = e.id) as "episodes",
            (select count(*)::int from ebook_episodes ee join episodes x on x.id = ee.episode_id
              where ee.ebook_id = e.id and x.transcript is not null) as "transcribed",
            (select count(*)::int from jsonb_object_keys(e.maps)) as "mapped",
            (select count(*)::int from chapters where ebook_id = e.id) as "chapters",
            (select count(*)::int from chapters where ebook_id = e.id and status = 'done') as "chaptersDone",
            (select count(*)::int from chapters where ebook_id = e.id and status = 'failed') as "chaptersFailed"
       from ebooks e where e.id = $1`,
    [ebookId],
  );
  return rows[0];
}
