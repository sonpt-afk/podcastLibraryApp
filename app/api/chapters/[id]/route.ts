import { z } from 'zod';
import { authed, type Ctx } from '@/lib/api';
import { ownedChapterEbook, ServiceError } from '@/lib/ebooks';
import { editChapter, markOpened, regenerateChapter, undoChapter } from '@/lib/pipeline';

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), markdown: z.string().max(200_000) }),
  z.object({ action: z.literal('regenerate'), instruction: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('undo') }),
  z.object({ action: z.literal('open') }),
]);

export const POST = authed(async (user, req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await ownedChapterEbook(user.id, id))) throw new ServiceError('Not found', 404);
  const body = Action.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ServiceError('Invalid request.');
  const a = body.data;
  if (a.action === 'open') await markOpened(id);
  else if (a.action === 'edit') await editChapter(id, a.markdown);
  else if (a.action === 'undo') {
    if (!(await undoChapter(id))) throw new ServiceError('Nothing to undo.', 409);
  } else if (!(await regenerateChapter(id, a.instruction || undefined))) throw new ServiceError('Chapter cannot be regenerated right now.', 409);
  return Response.json({ ok: true });
});
