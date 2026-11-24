import type { Segment } from './providers/types';

// ADR-0003: anything in quotation marks must appear (after normalisation) in the Chapter's own segments.

const MIN_QUOTE_WORDS = 4; // shorter spans are scare-quotes / terms, not testimony

/** Lowercase, unify smart quotes, drop punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Quote {
  text: string;
  start: number; // index of the opening quote mark in the source
  end: number; // index just past the closing quote mark
}

export function extractQuotes(markdown: string): Quote[] {
  const out: Quote[] = [];
  const re = /“([^”]+)”|"([^"]+)"/g;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    out.push({ text: m[1] ?? m[2], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const pool = (segments: Segment[]) => ` ${normalize(segments.map((s) => s.text).join(' '))} `;

function isGrounded(quote: string, haystack: string): boolean {
  // "..." / ellipsis inside a quote = the speaker's words with a gap; each fragment must be present.
  return quote
    .split(/…|\.{3}/)
    .map(normalize)
    .filter(Boolean)
    .every((frag) => haystack.includes(` ${frag} `));
}

/** Quotes (long enough to matter) that are NOT found in the segments. */
export function ungroundedQuotes(markdown: string, segments: Segment[]): Quote[] {
  const hay = pool(segments);
  return extractQuotes(markdown).filter(
    (q) => normalize(q.text).split(' ').length >= MIN_QUOTE_WORDS && !isGrounded(q.text, hay),
  );
}

/** Remove the quotation marks around the given quotes, keeping the words (paraphrase fallback). */
export function demoteQuotes(markdown: string, quotes: Quote[]): string {
  let out = markdown;
  for (const q of [...quotes].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, q.start) + q.text + out.slice(q.end);
  }
  return out;
}

export interface Flags {
  unverifiedNumbers: string[];
  unverifiedNames: string[];
}

/** Numbers and multi-word proper names in the draft that never occur in the segments (SPEC §6, shown as editor badges). */
export function flagUnverified(markdown: string, segments: Segment[]): Flags {
  const hay = pool(segments);
  const body = markdown.replace(/^#{1,6} .*$/gm, ''); // headings are Title Case by design
  const numbers = [...new Set(body.match(/\d[\d,.]*\d|\d/g) ?? [])].filter(
    (n) => !hay.includes(` ${normalize(n)} `) && !hay.includes(normalize(n)),
  );
  const names = [...new Set(body.match(/\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g) ?? [])].filter(
    (n) => !hay.includes(` ${normalize(n)} `),
  );
  return { unverifiedNumbers: numbers, unverifiedNames: names };
}
