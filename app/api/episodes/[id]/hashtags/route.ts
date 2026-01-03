import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { tag } = await request.json();

    if (!tag || tag.trim().length === 0) {
      return NextResponse.json(
        { error: 'Tag cannot be empty' },
        { status: 400 }
      );
    }

    await query(
      `INSERT INTO hashtags (episode_id, tag) VALUES ($1, $2)
       ON CONFLICT (episode_id, tag) DO NOTHING`,
      [id, tag.trim()]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error adding hashtag:', error);
    return NextResponse.json(
      { error: 'Failed to add hashtag' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get('tag');

    if (!tag) {
      return NextResponse.json(
        { error: 'Tag is required' },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM hashtags WHERE episode_id = $1 AND tag = $2`,
      [id, tag]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing hashtag:', error);
    return NextResponse.json(
      { error: 'Failed to remove hashtag' },
      { status: 500 }
    );
  }
}
