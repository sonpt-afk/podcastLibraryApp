import { fakeGenerator, fakeTranscriber } from './fake';
import type { Generator, Transcriber } from './types';

// Selected per call (not at import) so tests can flip env; real providers load lazily so the fake path needs no API keys.
export async function getTranscriber(): Promise<Transcriber> {
  if (process.env.TRANSCRIBE_PROVIDER === 'real') return (await import('./assemblyai')).assemblyAi;
  return fakeTranscriber;
}

export async function getGenerator(): Promise<Generator> {
  if (process.env.GENERATE_PROVIDER === 'real') return (await import('./openai')).openAi;
  return fakeGenerator;
}
