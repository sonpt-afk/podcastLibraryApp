import { authed, tooMany } from '@/lib/api';
import { importFeed, ServiceError } from '@/lib/ebooks';
import { clientIp, rateLimit } from '@/lib/rate-limit';

const HOUR = 3600_000;

export const POST = authed(async (user, req: Request) => {
  // SPEC §10: 10/hour and 20/day per user.
  if (!rateLimit(`import:h:${user.id}`, 10, HOUR) || !rateLimit(`import:d:${user.id}`, 20, 24 * HOUR)) return tooMany();
  const body = (await req.json().catch(() => null)) as { feedUrl?: unknown; attested?: unknown } | null;
  if (typeof body?.feedUrl !== 'string' || !body.feedUrl.trim()) throw new ServiceError('feedUrl required');
  const podcastId = await importFeed(user.id, body.feedUrl.trim(), clientIp(req), body.attested === true);
  return Response.json({ podcastId });
});
