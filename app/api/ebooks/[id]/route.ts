import { z } from 'zod';
import { authed, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';
import { ownsEbook, ServiceError } from '@/lib/ebooks';
import { approveOutline, exportBlockers, regenerateAll, resolveAttention, snapshot } from '@/lib/pipeline';

async function own(userId: string, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!(await ownsEbook(userId, id))) throw new ServiceError('Not found', 404);
  return id;
}

export const GET = authed(async (user, _req: Request, ctx: Ctx) => {
  const id = await own(user.id, ctx);
  const [ebook, chapters, blockers, snap] = await Promise.all([
    query(
      `select id, podcast_id as "podcastId", title, subtitle, author, accent_color as "accentColor", brief, outline, omitted
         from ebooks where id = $1`,
      [id],
    ),
    query(
      `select id, chapter_no as "chapterNo", title, status, markdown, opened, hand_edited as "handEdited", flags,
              prev_markdown is not null as "canUndo"
         from chapters where ebook_id = $1 order by chapter_no`,
      [id],
    ),
    exportBlockers(id),
    snapshot(id),
  ]);
  return Response.json({ ebook: ebook.rows[0], chapters: chapters.rows, blockers, progress: snap });
});

const Meta = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  subtitle: z.string().trim().max(300).optional(),
  author: z.string().trim().max(200).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const PATCH = authed(async (user, req: Request, ctx: Ctx) => {
  const id = await own(user.id, ctx);
  const body = Meta.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ServiceError('Invalid metadata.');
  const entries = Object.entries(body.data);
  if (entries.length) {
    // Keys come from the zod whitelist above, so interpolating column names is safe.
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    await query(`update ebooks set ${sets} where id = $1`, [id, ...entries.map(([, v]) => v)]);
  }
  return Response.json({ ok: true });
});

const Range = z.object({ from: z.number().int().min(0), to: z.number().int().min(0) });
const Action = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('approve'),
    chapters: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          summary: z.string().max(2000),
          sources: z.array(z.object({ episodeId: z.string().uuid(), ranges: z.array(Range) })),
        }),
      )
      .min(1)
      .max(40),
  }),
  z.object({ action: z.literal('resolve'), resolution: z.enum(['drop', 'retry']), episodeId: z.string().uuid().optional() }),
  z.object({ action: z.literal('regenerateAll') }),
]);

export const POST = authed(async (user, req: Request, ctx: Ctx) => {
  const id = await own(user.id, ctx);
  const body = Action.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new ServiceError('Invalid request.');
  const a = body.data;
  if (a.action === 'approve') {
    try {
      if (!(await approveOutline(id, a.chapters))) throw new ServiceError('Outline is not awaiting approval.', 409);
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError((e as Error).message); // approveOutline's source validation message
    }
    return Response.json({ ok: true });
  }
  if (a.action === 'resolve') {
    await resolveAttention(id, a.resolution, a.episodeId);
    return Response.json({ ok: true });
  }
  return Response.json({ regenerating: await regenerateAll(id) });
});
