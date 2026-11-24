import { authed, type Ctx } from '@/lib/api';
import { ownsEbook, ServiceError } from '@/lib/ebooks';
import { advance } from '@/lib/pipeline';

/** One unit of pipeline work per call; the client polls this (ADR-0001). */
export const POST = authed(async (user, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await ownsEbook(user.id, id))) throw new ServiceError('Not found', 404);
  return Response.json(await advance(id));
});
