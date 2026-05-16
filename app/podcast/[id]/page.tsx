'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Heart, Star, RefreshCw } from 'lucide-react';
import { usePodcastStore } from '@/lib/store';
import type { Episode } from '@/lib/types';

export default function PodcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const podcastId = params.id as string;

  const { podcasts, episodes, setEpisodes, toggleFavorite, updateRating } = usePodcastStore();
  const podcast = podcasts.find((p) => p.id === podcastId);
  const podcastEpisodes = episodes[podcastId] ?? [];

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEpisodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/episodes`);
      if (!res.ok) throw new Error('Failed to fetch episodes');
      const data: Episode[] = await res.json();
      setEpisodes(podcastId, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const refreshEpisodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/podcasts/${podcastId}/episodes`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to refresh episodes');
      const data: Episode[] = await res.json();
      setEpisodes(podcastId, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (podcastEpisodes.length === 0) {
      fetchEpisodes();
    }
  }, [podcastId]);

  if (!podcast) {
    return (
      <div className="container mx-auto p-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <p className="mt-4">Podcast not found</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Button variant="ghost" onClick={() => router.back()}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      <div className="mt-4 flex items-center gap-4">
        {podcast.iconUrl && (
          <img src={podcast.iconUrl} alt={podcast.name} className="h-20 w-20 rounded-lg" />
        )}
        <div>
          <h1 className="text-2xl font-bold">{podcast.name}</h1>
          <p className="text-muted-foreground">{podcast.episodeCount} episodes</p>
        </div>
        <Button onClick={refreshEpisodes} disabled={loading} className="ml-auto">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && <p className="mt-4 text-red-500">{error}</p>}

      <div className="mt-6 space-y-4">
        {podcastEpisodes.map((episode) => (
          <Card key={episode.id}>
            <CardContent className="flex items-center gap-4 p-4">
              {episode.iconUrl && (
                <img src={episode.iconUrl} alt="" className="h-12 w-12 rounded" />
              )}
              <div className="flex-1">
                <h3 className="font-medium">{episode.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {new Date(episode.broadcastDate).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => toggleFavorite(episode.id)}
              >
                <Heart className={`h-4 w-4 ${episode.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
              </Button>
              <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Button
                    key={star}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 p-0"
                    onClick={() => updateRating(episode.id, star)}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        episode.rating && episode.rating >= star
                          ? 'fill-yellow-500 text-yellow-500'
                          : ''
                      }`}
                    />
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
