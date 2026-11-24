import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

export interface FeedEpisode {
  guid: string;
  title: string;
  audioUrl: string;
  durationS: number | null;
  publishedAt: string | null; // ISO-8601
  description: string;
}

export interface Feed {
  title: string;
  description: string;
  artUrl: string | null;
  language: string | null;
  ownerEmail: string | null;
  podcastGuid: string | null;
  episodes: FeedEpisode[]; // newest first
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => name === 'item',
});

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

// Element text can be a string, number, or {'#text', '@_attr'} when attributes exist.
function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  return String(v).trim();
}

function attr(v: unknown, name: string): string | null {
  const a = v && typeof v === 'object' ? (v as Record<string, unknown>)[`@_${name}`] : undefined;
  return typeof a === 'string' && a ? a : null;
}

/** "1:02:03" | "62:03" | "3723" -> seconds */
export function parseDuration(raw: string): number | null {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(raw)) return null;
  const secs = raw.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
  return Math.round(secs);
}

export function parseFeed(xml: string): Feed {
  const rss = parser.parse(xml)?.rss;
  const ch = rss?.channel;
  if (!ch) throw new Error('Not an RSS podcast feed');

  const episodes: FeedEpisode[] = [];
  for (const item of (ch.item ?? []) as Record<string, unknown>[]) {
    const audioUrl = attr(item.enclosure, 'url');
    if (!audioUrl) continue; // no audio = nothing to transcribe
    const title = text(item.title) || 'Untitled episode';
    const pub = text(item.pubDate);
    const t = pub ? Date.parse(pub) : NaN;
    episodes.push({
      // Some hosts omit <guid>; SPEC §4 fallback keeps (podcast_id, guid) uniqueness stable.
      guid: text(item.guid) || sha1(audioUrl + title),
      title,
      audioUrl,
      durationS: parseDuration(text(item['itunes:duration'])),
      publishedAt: Number.isNaN(t) ? null : new Date(t).toISOString(),
      description: text(item['content:encoded']) || text(item.description),
    });
  }
  episodes.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  return {
    title: text(ch.title) || 'Untitled podcast',
    description: text(ch.description),
    artUrl: attr(ch['itunes:image'], 'href') ?? (text(ch.image?.url) || null),
    language: text(ch.language).toLowerCase() || null,
    ownerEmail: text(ch['itunes:owner']?.['itunes:email']) || null,
    podcastGuid: text(ch['podcast:guid']) || null,
    episodes,
  };
}

/** English gate (SPEC §6): missing language is allowed, "en" / "en-US" pass, everything else is blocked. */
export function isEnglish(language: string | null): boolean {
  return !language || /^en([-_]|$)/i.test(language);
}

/**
 * Stable identity for the free-quota key: survives host migrations when the feed has <podcast:guid>,
 * otherwise a hash of the normalised URL (https, lowercase host, no fragment/trailing slash/utm_*).
 */
export function feedIdentity(feedUrl: string, podcastGuid?: string | null): string {
  if (podcastGuid) return sha1(`guid:${podcastGuid.toLowerCase()}`);
  const u = new URL(feedUrl);
  u.protocol = 'https:';
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
  u.searchParams.sort();
  const path = u.pathname.replace(/\/+$/, '');
  return sha1(`url:${u.host.toLowerCase()}${path}${u.search}`);
}
