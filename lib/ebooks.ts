import pool, { query } from './db';
import { guardedFetch } from './guarded-fetch';
import { feedIdentity, isEnglish, parseFeed } from './rss';

export const ATTEST_TEXT_VERSION = 'attest-v1';
export const MAX_AUDIO_SECONDS = 6 * 3600;

/** Expected failure the route maps to a 4xx with `message` shown to the user. */
export class ServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Fetch + parse a feed, gate on English, upsert Podcast + Episodes, log the attestation. */
export async function importFeed(userId: string, feedUrl: string, ip: string, attested: boolean) {
  if (!attested) throw new ServiceError('Confirm you own or have rights to this podcast.');
  let xml: string;
  try {
    xml = (await guardedFetch(feedUrl)).body.toString('utf8');
  } catch (e) {
    throw new ServiceError(`Could not fetch that feed: ${(e as Error).message}`);
  }
  let feed;
  try {
    feed = parseFeed(xml);
  } catch (e) {
    throw new ServiceError(`That doesn't look like a podcast feed: ${(e as Error).message}`);
  }
  if (!isEnglish(feed.language)) throw new ServiceError('Only English podcasts are supported for now.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const p = await client.query<{ id: string }>(
      `insert into podcasts (user_id, feed_url, feed_identity, title, description, art_url, language, owner_email, attested_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now())
       on conflict (user_id, feed_identity) do update set
         feed_url = excluded.feed_url, title = excluded.title, description = excluded.description,
         art_url = excluded.art_url, language = excluded.language, owner_email = excluded.owner_email
       returning id`,
      [userId, feedUrl, feedIdentity(feedUrl, feed.podcastGuid), feed.title, feed.description, feed.artUrl, feed.language, feed.ownerEmail],
    );
    const podcastId = p.rows[0].id;
    await client.query(
      `insert into consent_log (user_id, podcast_id, kind, text_version, ip) values ($1,$2,'attest',$3,$4)`,
      [userId, podcastId, ATTEST_TEXT_VERSION, ip],
    );
    for (const e of feed.episodes) {
      await client.query(
        `insert into episodes (podcast_id, guid, title, description, audio_url, duration_s, published_at)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (podcast_id, guid) do update set title = excluded.title, description = excluded.description,
           audio_url = excluded.audio_url, duration_s = excluded.duration_s, published_at = excluded.published_at`,
        [podcastId, e.guid, e.title, e.description, e.audioUrl, e.durationS, e.publishedAt],
      );
    }
    await client.query('commit');
    return podcastId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** One Ebook per Podcast, ever (SPEC §3). Episodes must belong to the user's Podcast; audio capped at 6h. */
export async function createEbook(userId: string, podcastId: string, episodeIds: string[], brief: string) {
  const ids = [...new Set(episodeIds)];
  if (!ids.length) throw new ServiceError('Pick at least one episode.');
  const pod = await query<{ title: string }>('select title from podcasts where id = $1 and user_id = $2', [podcastId, userId]);
  if (!pod.rows[0]) throw new ServiceError('Podcast not found.', 404);
  const eps = await query<{ id: string; duration_s: number | null }>(
    'select id, duration_s from episodes where podcast_id = $1 and id = any($2)',
    [podcastId, ids],
  );
  if (eps.rows.length !== ids.length) throw new ServiceError('Some episodes are not part of this podcast.');
  // ponytail: unknown duration counts as 0; the transcript's real length is charged later.
  const total = eps.rows.reduce((s, r) => s + (r.duration_s ?? 0), 0);
  if (total > MAX_AUDIO_SECONDS) throw new ServiceError('Selected episodes exceed 6 hours of audio.');

  const client = await pool.connect();
  try {
    await client.query('begin');
    // The unique-per-podcast rule lives here (no schema constraint in SPEC §4); lock the podcast row to serialize creators.
    await client.query('select 1 from podcasts where id = $1 for update', [podcastId]);
    const dup = await client.query('select 1 from ebooks where podcast_id = $1', [podcastId]);
    if (dup.rows.length) throw new ServiceError('This podcast already has an Ebook.', 409);
    const b = await client.query<{ id: string }>(
      `insert into ebooks (podcast_id, user_id, title, brief) values ($1,$2,$3,$4) returning id`,
      [podcastId, userId, pod.rows[0].title, brief],
    );
    for (const [i, id] of ids.entries()) {
      await client.query('insert into ebook_episodes (ebook_id, episode_id, position) values ($1,$2,$3)', [b.rows[0].id, id, i]);
    }
    await client.query('commit');
    return b.rows[0].id;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function ownsEbook(userId: string, ebookId: string) {
  const r = await query('select 1 from ebooks where id = $1 and user_id = $2', [ebookId, userId]);
  return r.rows.length > 0;
}

/** Returns the chapter's ebook id if the user owns it, else null. */
export async function ownedChapterEbook(userId: string, chapterId: string) {
  const r = await query<{ ebook_id: string }>(
    'select c.ebook_id from chapters c join ebooks e on e.id = c.ebook_id where c.id = $1 and e.user_id = $2',
    [chapterId, userId],
  );
  return r.rows[0]?.ebook_id ?? null;
}
