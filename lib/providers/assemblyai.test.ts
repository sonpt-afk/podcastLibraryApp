import { afterEach, expect, it, vi } from 'vitest';
import { assemblyAi } from './assemblyai';

// Free regression check for the request shape (the live smoke test is the paid one). A wrong field name gets silently ignored by the API.
afterEach(() => vi.unstubAllGlobals());

it('submit pins the pre-recorded model with the plural speech_models field', async () => {
  process.env.ASSEMBLYAI_API_KEY = 'test-key';
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: 'job-1' })));
  vi.stubGlobal('fetch', fetchMock);

  await expect(assemblyAi.submit('https://example.com/a.mp3')).resolves.toBe('job-1');

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.speech_models).toEqual(['assemblyai-stt-3-7']);
  expect(body).not.toHaveProperty('speech_model');
});
