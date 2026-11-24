// SPEC §3/§12: the pipeline only ever talks to these two interfaces. Fake and real implementations are env-selected.

export interface Segment {
  id: number; // numbered per Episode, 0-based
  speaker: string; // "A", "B", ... (diarization labels)
  start_ms: number;
  text: string;
}

/** Inclusive range of segment ids within one Episode. */
export interface Range {
  from: number;
  to: number;
}

export type PollResult =
  | { status: 'processing' }
  | { status: 'completed'; segments: Segment[]; durationS: number }
  | { status: 'failed'; error: string; permanent: boolean };

export interface Transcriber {
  /** Start a transcription; returns the vendor's job id. */
  submit(audioUrl: string): Promise<string>;
  poll(vendorId: string): Promise<PollResult>;
  /** Delete the vendor-side transcript (SPEC §5.3, §11). */
  remove(vendorId: string): Promise<void>;
}

export interface Topic {
  title: string;
  summary: string;
  ranges: Range[];
}

export interface MapResult {
  topics: Topic[];
  /** Passages the rubric dropped (ads, intros, housekeeping, banter), shown to the Creator. */
  omitted: { range: Range; reason: string }[];
}

export interface OutlineChapter {
  title: string;
  summary: string;
  /** Which segments of which Episodes feed this Chapter. */
  sources: { episodeId: string; ranges: Range[] }[];
}

export interface Generator {
  mapEpisode(input: { title: string; segments: Segment[] }): Promise<MapResult>;
  mergeOutline(input: {
    brief: string;
    episodes: { episodeId: string; title: string; topics: Topic[] }[];
  }): Promise<OutlineChapter[]>;
  /** Returns Markdown. `strict` = retry after a failed quote check: no direct quotes unless verbatim. */
  draftChapter(input: {
    title: string;
    summary: string;
    brief: string;
    segments: Segment[];
    instruction?: string;
    strict?: boolean;
  }): Promise<string>;
}

/** A failure the pipeline may retry (5xx, timeout) vs. one it must not (bad input, 4xx). */
export class ProviderError extends Error {
  constructor(
    message: string,
    public permanent = false,
  ) {
    super(message);
  }
}
