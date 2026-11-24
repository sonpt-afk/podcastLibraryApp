import { z } from 'zod';
import { authed, tooMany } from '@/lib/api';
import { createEbook, ServiceError } from '@/lib/ebooks';
import { rateLimit } from '@/lib/rate-limit';

const Body = z.object({
  podcastId: z.string().uuid(),
  episodeIds: z.array(z.string().uuid()).min(1).max(200),
  brief: z.string().max(2000).default(''),
});

export const POST = authed(async (user, req: Request) => {
  if (!rateLimit(`create:${user.id}`, 10, 3600_000)) return tooMany();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ServiceError('Invalid request.');
  const id = await createEbook(user.id, body.data.podcastId, body.data.episodeIds, body.data.brief);
  return Response.json({ id });
});
