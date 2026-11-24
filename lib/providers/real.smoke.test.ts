import { describe, expect, it } from 'vitest';
import { assemblyAi } from './assemblyai';
import { openAi } from './openai';
import type { PollResult, Segment } from './types';

// Opt-in live smoke test: calls the REAL OpenAI and AssemblyAI APIs (cents, not dollars).
// Skipped unless SMOKE_REAL=1 and the keys + OPENAI_MODEL_* are set in .env. Plain `npm test` never runs it.
// SMOKE_AUDIO_URL: point at a shorter public clip to spend less on AssemblyAI (default is 8 MB, about 8 min).
const AUDIO_URL = process.env.SMOKE_AUDIO_URL ?? 'https://assembly.ai/sports_injuries.mp3';

const segments: Segment[] = [
  { id: 0, speaker: 'A', start_ms: 0, text: 'Welcome back. Today we talk about saving three months of rent.' },
  { id: 1, speaker: 'A', start_ms: 4000, text: 'Rule one: keep a cash buffer in a separate account.' },
  { id: 2, speaker: 'B', start_ms: 9000, text: 'Rule two: automate the transfer on payday so you never see the money.' },
  { id: 3, speaker: 'B', start_ms: 15000, text: 'Before we go, please like and subscribe. Thanks to our sponsor.' },
];

describe.runIf(process.env.SMOKE_REAL === '1')('real providers (live, costs cents)', () => {
  it('OpenAI maps an Episode to topics whose ranges stay inside the transcript', async () => {
    const map = await openAi.mapEpisode({ title: 'Saving for rent', segments });
    expect(map.topics.length).toBeGreaterThan(0);
    for (const t of map.topics) {
      for (const r of t.ranges) expect(r.from >= 0 && r.from <= r.to && r.to <= 3, JSON.stringify(r)).toBe(true);
    }
  });

  it('OpenAI drafts a Markdown chapter', async () => {
    const md = await openAi.draftChapter({
      title: 'Build a buffer',
      summary: 'Cash buffer and payday automation',
      brief: 'A short guide for newcomers.',
      segments: segments.slice(0, 3),
    });
    expect(md.trim().startsWith('#')).toBe(true);
  });

  it('AssemblyAI transcribes a public clip with speaker labels, then deletes it', async () => {
    const id = await assemblyAi.submit(AUDIO_URL);
    try {
      let result: PollResult = { status: 'processing' };
      for (let i = 0; i < 120 && result.status === 'processing'; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        result = await assemblyAi.poll(id);
      }
      expect(result.status, JSON.stringify(result)).toBe('completed');
      if (result.status !== 'completed') return;
      expect(result.durationS).toBeGreaterThan(0);
      expect(result.segments.length).toBeGreaterThan(0);
      expect(result.segments.every((s) => s.speaker && s.text)).toBe(true);
    } finally {
      await assemblyAi.remove(id);
    }
  }, 11 * 60_000);
});
