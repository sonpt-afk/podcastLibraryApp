import { ProviderError } from './types';
import type { PollResult, Transcriber } from './types';

const BASE = 'https://api.assemblyai.com/v2/transcript';

async function call(path: string, init: RequestInit = {}) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new ProviderError('ASSEMBLYAI_API_KEY not set', true);
  const res = await fetch(BASE + path, {
    ...init,
    headers: { authorization: key, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // 4xx (except rate limit) = our request is bad: retrying will not help
    throw new ProviderError(`AssemblyAI ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429);
  }
  return res.json();
}

interface Utterance {
  speaker: string;
  start: number;
  text: string;
}

export const assemblyAi: Transcriber = {
  async submit(audioUrl) {
    // Pinned: account defaults change (AssemblyAI docs say set it explicitly). Pre-recorded takes plural `speech_models`; singular `speech_model` is deprecated here.
    const body = { audio_url: audioUrl, speaker_labels: true, language_code: 'en', speech_models: ['assemblyai-stt-3-7'] };
    const t = await call('', { method: 'POST', body: JSON.stringify(body) });
    return t.id as string;
  },

  async poll(vendorId): Promise<PollResult> {
    const t = await call(`/${vendorId}`);
    if (t.status === 'error') {
      // bad/unreachable audio is the Episode's problem, not a blip: surface as needs_attention
      return { status: 'failed', error: String(t.error ?? 'transcription failed'), permanent: true };
    }
    if (t.status !== 'completed') return { status: 'processing' };
    const utterances: Utterance[] = t.utterances ?? [];
    return {
      status: 'completed',
      durationS: Math.round(t.audio_duration ?? 0),
      segments: utterances.map((u, id) => ({ id, speaker: u.speaker, start_ms: u.start, text: u.text })),
    };
  },

  async remove(vendorId) {
    await call(`/${vendorId}`, { method: 'DELETE' });
  },
};
