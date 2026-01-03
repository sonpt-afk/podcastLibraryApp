import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    // Validate URL
    if (!url || !url.startsWith('https://www.podbean.com/podcast-detail/')) {
      return NextResponse.json(
        { error: 'Invalid URL' },
        { status: 400 }
      );
    }

    // Launch puppeteer to scrape the podcast page
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Navigate to the podcast page
    const response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Check if page exists (not 404)
    if (!response || response.status() === 404) {
      await browser.close();
      return NextResponse.json(
        { error: 'Podcast not found' },
        { status: 404 }
      );
    }

    // Scrape podcast details
    const podcastData = await page.evaluate(() => {
      const name = document.querySelector('h1.title, .podcast-title')?.textContent?.trim() || 'Unknown Podcast';
      const iconUrl = document.querySelector('img.podcast-logo, .podcast-image')?.getAttribute('src') || '';

      // Count recent episodes (usually displayed on the main page)
      const episodeElements = document.querySelectorAll('.episode-item, .podcast-episode');
      const episodeCount = episodeElements.length || 10; // Default to 10 if we can't count

      return {
        name,
        iconUrl,
        episodeCount,
      };
    });

    await browser.close();

    // Save to database
    const result = await query(
      `INSERT INTO podcasts (name, url, icon_url, episode_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO UPDATE
       SET name = $1, icon_url = $3, episode_count = $4
       RETURNING *`,
      [podcastData.name, url, podcastData.iconUrl, podcastData.episodeCount]
    );

    return NextResponse.json({
      ...result.rows[0],
      name: podcastData.name,
      url,
      iconUrl: podcastData.iconUrl,
      episodeCount: podcastData.episodeCount,
    });
  } catch (error) {
    console.error('Error scraping podcast:', error);
    return NextResponse.json(
      { error: 'Failed to scrape podcast' },
      { status: 500 }
    );
  }
}
