import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractPodbeanSlug, buildRssFeedUrl, parsePodcastFromRss } from '@/lib/rss';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    const slug = extractPodbeanSlug(url);
    if (!slug) {
      return NextResponse.json(
        { error: 'Invalid Podbean URL. Use format: https://yourpodcast.podbean.com' },
        { status: 400 }
      );
    }

    const rssUrl = buildRssFeedUrl(slug);
    const rssResponse = await fetch(rssUrl);

    if (!rssResponse.ok) {
      return NextResponse.json(
        { error: 'Could not fetch podcast feed. Check the URL.' },
        { status: 404 }
      );
    }

    const xml = await rssResponse.text();
    const podcastData = parsePodcastFromRss(xml);

    const result = await query(
      `INSERT INTO podcasts (url, name, icon_url, episode_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO UPDATE SET
         name = EXCLUDED.name,
         icon_url = EXCLUDED.icon_url,
         episode_count = EXCLUDED.episode_count,
         updated_at = NOW()
       RETURNING id, url, name, icon_url as "iconUrl", episode_count as "episodeCount"`,
      [url, podcastData.title, podcastData.iconUrl, 0]
    );

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error('Error adding podcast:', error);
    return NextResponse.json(
      { error: 'Failed to add podcast' },
      { status: 500 }
    );
  }
}
