import { authed } from '@/lib/api';
import { query } from '@/lib/db';

export const GET = authed(async (user) => {
  const r = await query(
    `select p.id, p.title, p.art_url as "artUrl", (select id from ebooks e where e.podcast_id = p.id) as "ebookId"
     from podcasts p where p.user_id = $1 order by p.created_at desc`,
    [user.id],
  );
  return Response.json({ podcasts: r.rows });
});
