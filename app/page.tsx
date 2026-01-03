'use client';

import { usePodcastStore } from '@/lib/store';
import { PodcastCard } from '@/components/podcast-card';
import { AddPodcastDialog } from '@/components/add-podcast-dialog';

export default function Home() {
  const podcasts = usePodcastStore((state) => state.podcasts);

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Son Podcast Library
            </h1>
            <p className="text-muted-foreground mt-2">
              Your personalized collection of favorite podcasts
            </p>
          </div>
          <AddPodcastDialog />
        </div>

        <div className="relative">
          {podcasts.length === 0 ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center">
                <p className="text-6xl font-bold text-muted-foreground/20 select-none">
                  No podcasts added yet
                </p>
                <p className="text-muted-foreground mt-4">
                  Click the + button above to add your first podcast
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {podcasts.map((podcast) => (
                <PodcastCard key={podcast.id} podcast={podcast} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
