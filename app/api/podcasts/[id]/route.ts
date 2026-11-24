import { authed, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';
import { ServiceError } from '@/lib/ebooks';

export const GET = authed(async (user, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = await query(
    `select id, title, description, art_url as "artUrl", (select id from ebooks e where e.podcast_id = podcasts.id) as "ebookId"
     from podcasts where id = $1 and user_id = $2`,
    [id, user.id],
  );
  if (!p.rows[0]) throw new ServiceError('Not found', 404);
  const eps = await query(
    `select id, title, duration_s as "durationS", published_at as "publishedAt" from episodes
     where podcast_id = $1 order by published_at desc nulls last`,
    [id],
  );
  return Response.json({ podcast: p.rows[0], episodes: eps.rows });
});
