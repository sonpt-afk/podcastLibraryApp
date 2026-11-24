import { ProviderError } from './types';
import type { Generator, MapResult, OutlineChapter, PollResult, Segment, Transcriber } from './types';

// Deterministic providers for tests/e2e (TRANSCRIBE_PROVIDER=fake / GENERATE_PROVIDER=fake). Free, instant.

/** Tests mutate this to inject failures. Reset with `resetFake()`. */
export const fakeControl = {
  /** audio URLs whose transcription fails permanently */
  failTranscribe: new Set<string>(),
  /** next N draftChapter calls throw a transient error */
  transientDraftFailures: 0,
  /** non-strict drafts include an invented quote (exercises the quote check) */
  hallucinate: false,
  draftCalls: 0,
  removed: [] as string[],
};

export function resetFake() {
  fakeControl.failTranscribe.clear();
  fakeControl.transientDraftFailures = 0;
  fakeControl.hallucinate = false;
  fakeControl.draftCalls = 0;
  fakeControl.removed = [];
}

const TEXTS = [
  'This episode is brought to you by Acme, use code SAVE for ten percent off.', // ad
  'Welcome back to the show, today we are talking about growing a newsletter.',
  'I started in 2019 with twelve subscribers and honestly nobody cared at first.',
  'The thing that changed everything was writing one useful post every single week.',
  'Jane Doe told me that consistency beats talent when you are building an audience.',
  'So the first lesson is simple: ship weekly, even when it feels embarrassing.',
  'Now let us move on to monetization and how we priced the first paid tier.',
  'We charged nineteen dollars a month and about four percent of readers upgraded.',
  'The second lesson is to price for the outcome, not for the word count.',
  'Anyway, thanks for listening, and please leave a review if you enjoyed this.', // outro
];

export const CANNED_SEGMENTS: Segment[] = TEXTS.map((text, id) => ({
  id,
  speaker: id % 3 === 2 ? 'B' : 'A',
  start_ms: id * 15_000,
  text,
}));

export const fakeTranscriber: Transcriber = {
  async submit(audioUrl) {
    return `fake:${audioUrl}`;
  },
  async poll(vendorId): Promise<PollResult> {
    if (fakeControl.failTranscribe.has(vendorId.slice('fake:'.length))) {
      return { status: 'failed', error: 'unsupported audio', permanent: true };
    }
    return { status: 'completed', segments: CANNED_SEGMENTS, durationS: 150 };
  },
  async remove(vendorId) {
    fakeControl.removed.push(vendorId);
  },
};

export const fakeGenerator: Generator = {
  async mapEpisode({ segments }): Promise<MapResult> {
    const last = segments.length - 1;
    const mid = Math.floor(segments.length / 2);
    return {
      topics: [
        { title: 'Growing the audience', summary: 'Weekly shipping builds an audience.', ranges: [{ from: 1, to: mid - 1 }] },
        { title: 'Pricing the paid tier', summary: 'Price for the outcome.', ranges: [{ from: mid, to: last - 1 }] },
      ],
      omitted: [
        { range: { from: 0, to: 0 }, reason: 'sponsor ad' },
        { range: { from: last, to: last }, reason: 'outro' },
      ],
    };
  },

  async mergeOutline({ episodes }): Promise<OutlineChapter[]> {
    // one Chapter per topic position, pulling that topic from every Episode
    const n = Math.max(...episodes.map((e) => e.topics.length));
    return Array.from({ length: n }, (_, i) => {
      const withTopic = episodes.filter((e) => e.topics[i]);
      return {
        title: withTopic[0].topics[i].title,
        summary: withTopic[0].topics[i].summary,
        sources: withTopic.map((e) => ({ episodeId: e.episodeId, ranges: e.topics[i].ranges })),
      };
    });
  },

  async draftChapter({ title, segments, instruction, strict }) {
    fakeControl.draftCalls++;
    if (fakeControl.transientDraftFailures > 0) {
      fakeControl.transientDraftFailures--;
      throw new ProviderError('upstream 503');
    }
    const first = segments[0]?.text ?? '';
    const verbatim = first.split(' ').slice(0, 8).join(' ').replace(/[.,:;!?]+$/, '');
    const lines = [`# ${title}`, '', `As one speaker put it, "${verbatim}". That framed the whole discussion.`];
    if (fakeControl.hallucinate && !strict) {
      lines.push('', 'They also promised "we will triple revenue within one single quarter" which never came up.');
    }
    if (instruction) lines.push('', `(Revised: ${instruction})`);
    return lines.join('\n');
  },
};
