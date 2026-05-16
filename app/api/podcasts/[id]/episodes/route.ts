import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractPodbeanSlug, buildRssFeedUrl, parseEpisodesFromRss } from '@/lib/rss';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch episodes from database
    const result = await query(
      `SELECT e.id, e.podcast_id as "podcastId", e.title, e.icon_url as "iconUrl",
              e.broadcast_date as "broadcastDate", e.episode_url as "episodeUrl",
              e.is_favorite as "isFavorite", e.rating,
              COALESCE(json_agg(h.tag) FILTER (WHERE h.tag IS NOT NULL), '[]') as hashtags
       FROM episodes e
       LEFT JOIN hashtags h ON e.id = h.episode_id
       WHERE e.podcast_id = $1
       GROUP BY e.id
       ORDER BY e.is_favorite DESC, e.rating DESC NULLS LAST, e.broadcast_date DESC`,
      [id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching episodes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch episodes' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get podcast URL from database
    const podcastResult = await query(
      'SELECT url FROM podcasts WHERE id = $1',
      [id]
    );

    if (podcastResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Podcast not found' },
        { status: 404 }
      );
    }

    const podcastUrl = podcastResult.rows[0].url;
    const slug = extractPodbeanSlug(podcastUrl);

    if (!slug) {
      return NextResponse.json(
        { error: 'Invalid podcast URL format' },
        { status: 400 }
      );
    }

    const rssUrl = buildRssFeedUrl(slug);
    const rssResponse = await fetch(rssUrl);

    if (!rssResponse.ok) {
      return NextResponse.json(
        { error: 'Could not fetch podcast feed' },
        { status: 404 }
      );
    }

    const xml = await rssResponse.text();
    const episodes = parseEpisodesFromRss(xml);

    // Save episodes to database
    for (const episode of episodes) {
      await query(
        `INSERT INTO episodes (podcast_id, title, icon_url, broadcast_date, episode_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [id, episode.title, episode.iconUrl, episode.broadcastDate, episode.episodeUrl]
      );
    }

    // Return updated episodes
    const result = await query(
      `SELECT e.id, e.podcast_id as "podcastId", e.title, e.icon_url as "iconUrl",
              e.broadcast_date as "broadcastDate", e.episode_url as "episodeUrl",
              e.is_favorite as "isFavorite", e.rating,
              COALESCE(json_agg(h.tag) FILTER (WHERE h.tag IS NOT NULL), '[]') as hashtags
       FROM episodes e
       LEFT JOIN hashtags h ON e.id = h.episode_id
       WHERE e.podcast_id = $1
       GROUP BY e.id
       ORDER BY e.is_favorite DESC, e.rating DESC NULLS LAST, e.broadcast_date DESC`,
      [id]
    );

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error scraping episodes:', error);
    return NextResponse.json(
      { error: 'Failed to scrape episodes' },
      { status: 500 }
    );
  }
}
