import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pool, { query } from './db';
import { createEbook, importFeed, ownedChapterEbook, ownsEbook, ServiceError } from './ebooks';

let xml = '';
vi.mock('./guarded-fetch', () => ({
  guardedFetch: async () => ({ url: '', status: 200, contentType: 'text/xml', body: Buffer.from(xml) }),
}));

const feed = (lang = 'en', durations = ['00:30:00', '00:20:00']) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Pod</title><description>d</description><language>${lang}</language>
${durations
  .map(
    (d, i) => `<item><title>Ep ${i}</title><guid>g${i}</guid><pubDate>Wed, 01 Jan 2026 00:00:00 GMT</pubDate>
<enclosure url="https://cdn.test/${i}.mp3" type="audio/mpeg" length="1"/><itunes:duration>${d}</itunes:duration></item>`,
  )
  .join('\n')}
</channel></rss>`;

beforeEach(async () => {
  await query(`truncate "user" cascade`);
  for (const id of ['u1', 'u2']) {
    await query(`insert into "user" (id, name, email, "emailVerified") values ($1, 'U', $1 || '@x.test', true)`, [id]);
  }
  xml = feed();
});
afterAll(() => pool.end());

describe('importFeed', () => {
  it('requires attestation, rejects non-English', async () => {
    await expect(importFeed('u1', 'https://f.test/rss', '1.1.1.1', false)).rejects.toThrow(/rights/);
    xml = feed('fr');
    await expect(importFeed('u1', 'https://f.test/rss', '1.1.1.1', true)).rejects.toThrow(/English/);
  });

  it('upserts podcast + episodes and logs attestation; re-import does not duplicate', async () => {
    const a = await importFeed('u1', 'https://f.test/rss', '1.1.1.1', true);
    const b = await importFeed('u1', 'https://f.test/rss', '1.1.1.1', true);
    expect(b).toBe(a);
    expect((await query('select 1 from episodes')).rows).toHaveLength(2);
    const log = await query('select kind, ip from consent_log');
    expect(log.rows).toEqual([{ kind: 'attest', ip: '1.1.1.1' }, { kind: 'attest', ip: '1.1.1.1' }]);
  });
});

describe('createEbook', () => {
  async function setup() {
    const pid = await importFeed('u1', 'https://f.test/rss', 'ip', true);
    const eps = (await query<{ id: string }>('select id from episodes order by guid')).rows.map((r) => r.id);
    return { pid, eps };
  }

  it('creates one ebook with ordered episodes; second create conflicts', async () => {
    const { pid, eps } = await setup();
    const id = await createEbook('u1', pid, eps, 'brief');
    const pos = await query('select position from ebook_episodes where ebook_id = $1 order by position', [id]);
    expect(pos.rows).toHaveLength(2);
    await expect(createEbook('u1', pid, eps, 'x')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects another user, empty selection, foreign episodes and >6h audio', async () => {
    const { pid, eps } = await setup();
    await expect(createEbook('u2', pid, eps, '')).rejects.toBeInstanceOf(ServiceError);
    await expect(createEbook('u1', pid, [], '')).rejects.toThrow(/at least one/);
    await expect(createEbook('u1', pid, ['00000000-0000-0000-0000-000000000000'], '')).rejects.toThrow(/not part/);
    await query('update episodes set duration_s = 4 * 3600');
    await expect(createEbook('u1', pid, eps, '')).rejects.toThrow(/6 hours/);
  });

  it('ownership helpers', async () => {
    const { pid, eps } = await setup();
    const id = await createEbook('u1', pid, eps, '');
    const ch = await query<{ id: string }>(`insert into chapters (ebook_id, chapter_no, title) values ($1, 1, 't') returning id`, [id]);
    expect(await ownsEbook('u1', id)).toBe(true);
    expect(await ownsEbook('u2', id)).toBe(false);
    expect(await ownedChapterEbook('u1', ch.rows[0].id)).toBe(id);
    expect(await ownedChapterEbook('u2', ch.rows[0].id)).toBeNull();
  });
});
