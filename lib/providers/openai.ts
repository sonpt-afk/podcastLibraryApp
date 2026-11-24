import { z } from 'zod';
import { ProviderError } from './types';
import type { Generator, Segment } from './types';

// Plain fetch to Chat Completions on the standard tier. Flex was tried first (half price) but its capacity 429s stalled runs. Model names come from env.

const range = z.object({ from: z.number().int(), to: z.number().int() });
const mapSchema = z.object({
  topics: z.array(z.object({ title: z.string(), summary: z.string(), ranges: z.array(range) })),
  omitted: z.array(z.object({ range, reason: z.string() })),
});
const outlineSchema = z.object({
  chapters: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      sources: z.array(z.object({ episodeId: z.string(), ranges: z.array(range) })),
    }),
  ),
});

async function chat(model: string | undefined, system: string, user: string, json: boolean): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !model) throw new ProviderError('OPENAI_API_KEY / model env not set', true);
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      service_tier: 'default',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    // The body names the cause. insufficient_quota = out of credit (permanent). Other 429s are rate limits (transient).
    const body = await res.text().catch(() => '');
    const quota = body.includes('insufficient_quota');
    const permanent = quota || (res.status >= 400 && res.status < 500 && res.status !== 429);
    throw new ProviderError(`OpenAI ${res.status}: ${body.slice(0, 300)}`, permanent);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new ProviderError('OpenAI: empty completion');
  return text;
}

async function chatJson<T>(model: string | undefined, schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  const parsed = schema.safeParse(JSON.parse(await chat(model, system, user, true)));
  if (!parsed.success) throw new ProviderError('OpenAI: malformed JSON shape'); // transient: a retry usually fixes it
  return parsed.data;
}

const fmt = (segs: Segment[]) => segs.map((s) => `[${s.id}] ${s.speaker}: ${s.text}`).join('\n');

const RUBRIC =
  'Keep substance: ideas, stories, advice, specifics. Omit: sponsor ads, intros/outros, housekeeping, banter, "like and subscribe". ' +
  'Segment ids are integers in [brackets]; ranges are inclusive.';

export const openAi: Generator = {
  mapEpisode({ title, segments }) {
    return chatJson(
      process.env.OPENAI_MODEL_MAP,
      mapSchema,
      `You outline one podcast transcript. ${RUBRIC} Reply JSON: {"topics":[{"title","summary","ranges":[{"from","to"}]}],"omitted":[{"range":{"from","to"},"reason"}]}.`,
      `Episode: ${title}\n\n${fmt(segments)}`,
    );
  },

  async mergeOutline({ brief, episodes }) {
    const out = await chatJson(
      process.env.OPENAI_MODEL_MAP,
      outlineSchema,
      'Merge per-episode topics into a coherent ebook outline: group related topics across episodes, order logically, 5-15 chapters. ' +
        'Every source must reference an episodeId and ranges taken from the input. ' +
        'Reply JSON: {"chapters":[{"title","summary","sources":[{"episodeId","ranges":[{"from","to"}]}]}]}.',
      `Creator brief: ${brief}\n\n${JSON.stringify(episodes)}`,
    );
    return out.chapters;
  },

  draftChapter({ title, summary, brief, segments, instruction, strict }) {
    const rules = [
      'Write one ebook chapter in Markdown from ONLY the transcript excerpts given. Start with "# <title>".',
      'Never add facts, numbers, or names that are not in the excerpts.',
      strict
        ? 'Do NOT use quotation marks at all: paraphrase everything.'
        : 'Use quotation marks only for text copied verbatim from the excerpts; otherwise paraphrase.',
      instruction ? `Creator instruction: ${instruction}` : '',
    ].filter(Boolean);
    return chat(
      process.env.OPENAI_MODEL_CHAPTER,
      rules.join(' '),
      `Book brief: ${brief}\nChapter: ${title}\nSummary: ${summary}\n\nExcerpts:\n${fmt(segments)}`,
      false,
    );
  },
};
