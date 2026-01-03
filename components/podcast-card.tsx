'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Podcast } from '@/lib/types';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface PodcastCardProps {
  podcast: Podcast;
}

export function PodcastCard({ podcast }: PodcastCardProps) {
  const router = useRouter();

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow"
      onClick={() => router.push(`/podcast/${podcast.id}`)}
    >
      <CardHeader>
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted">
            {podcast.iconUrl ? (
              <Image
                src={podcast.iconUrl}
                alt={podcast.name}
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
                {podcast.name.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate">{podcast.name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {podcast.episodeCount} recent episodes
            </p>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
