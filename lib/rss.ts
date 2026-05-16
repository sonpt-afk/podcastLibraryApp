export function extractPodbeanSlug(url: string): string | null {
  const match = url.match(/^https?:\/\/([^.]+)\.podbean\.com\/?/);
  return match ? match[1] : null;
}

export function buildRssFeedUrl(slug: string): string {
  return `https://feed.podbean.com/${slug}/feed.xml`;
}

export interface RssPodcast {
  title: string;
  iconUrl: string;
  description: string;
}

export interface RssEpisode {
  title: string;
  episodeUrl: string;
  iconUrl: string;
  broadcastDate: Date;
  description: string;
}

export function parsePodcastFromRss(xml: string): RssPodcast {
  const title = xml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
    ?? xml.match(/<title>(.*?)<\/title>/)?.[1]
    ?? 'Unknown Podcast';

  const iconUrl = xml.match(/<itunes:image href="([^"]+)"/)?.[1]
    ?? xml.match(/<image>[\s\S]*?<url>(.*?)<\/url>[\s\S]*?<\/image>/)?.[1]
    ?? '';

  const description = xml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
    ?? xml.match(/<description>(.*?)<\/description>/)?.[1]
    ?? '';

  return { title, iconUrl, description };
}

export function parseEpisodesFromRss(xml: string): RssEpisode[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  return items.map((item) => {
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      ?? item.match(/<title>(.*?)<\/title>/)?.[1]
      ?? 'Untitled Episode';

    const episodeUrl = item.match(/<link>(.*?)<\/link>/)?.[1] ?? '';

    const iconUrl = item.match(/<itunes:image href="([^"]+)"/)?.[1] ?? '';

    const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    const broadcastDate = pubDate ? new Date(pubDate) : new Date();

    const description = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/)?.[1]
      ?? item.match(/<description>(.*?)<\/description>/)?.[1]
      ?? '';

    return { title, episodeUrl, iconUrl, broadcastDate, description };
  });
}
