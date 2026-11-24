import { authed, type Ctx } from '@/lib/api';
import { query } from '@/lib/db';
import { ownsEbook, ServiceError } from '@/lib/ebooks';
import { renderEbookPdf } from '@/lib/pdf';
import { exportBlockers } from '@/lib/pipeline';

export const runtime = 'nodejs';

/** Rendered on demand, never stored (ADR-0003). Blocked until every Chapter is drafted and opened (SPEC §5.6). */
export const GET = authed(async (user, _req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await ownsEbook(user.id, id))) throw new ServiceError('Not found', 404);

  const e = await query<{ title: string; subtitle: string; author: string; accent_color: string; status: string }>(
    'select title, subtitle, author, accent_color, status from ebooks where id = $1',
    [id],
  );
  const ebook = e.rows[0];
  if (!['review', 'exported'].includes(ebook.status)) throw new ServiceError('Ebook is not ready to export.', 409);

  const b = await exportBlockers(id);
  if (b.undone || b.unopened) {
    throw new ServiceError(`Open every chapter before exporting (${b.unopened} unopened, ${b.undone} not drafted).`, 409);
  }

  const ch = await query<{ title: string; markdown: string }>(
    'select title, markdown from chapters where ebook_id = $1 order by chapter_no',
    [id],
  );
  const pdf = await renderEbookPdf({
    title: ebook.title,
    subtitle: ebook.subtitle,
    author: ebook.author,
    accentColor: ebook.accent_color,
    chapters: ch.rows,
  });
  await query(`update ebooks set status = 'exported', exported_at = now() where id = $1`, [id]);

  const name = ebook.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'ebook';
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"` },
  });
});
