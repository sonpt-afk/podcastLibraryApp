import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { PodcastStore, Podcast, Episode } from './types';

export const usePodcastStore = create<PodcastStore>()(
  persist(
    (set) => ({
      podcasts: [],
      episodes: {},

      addPodcast: (podcast) =>
        set((state) => ({
          podcasts: [
            ...state.podcasts,
            {
              ...podcast,
              id: podcast.id ?? crypto.randomUUID(),
              createdAt: new Date(),
            },
          ],
        })),

      removePodcast: (id) =>
        set((state) => {
          const newEpisodes = { ...state.episodes };
          delete newEpisodes[id];
          return {
            podcasts: state.podcasts.filter((p) => p.id !== id),
            episodes: newEpisodes,
          };
        }),

      setEpisodes: (podcastId, episodes) =>
        set((state) => ({
          episodes: {
            ...state.episodes,
            [podcastId]: episodes,
          },
        })),

      setPodcasts: (podcasts) => set({ podcasts }),

      toggleFavorite: (episodeId, podcastId) =>
        set((state) => ({
          episodes: {
            ...state.episodes,
            [podcastId]: state.episodes[podcastId]?.map((ep) =>
              ep.id === episodeId ? { ...ep, isFavorite: !ep.isFavorite } : ep
            ) || [],
          },
        })),

      updateRating: (episodeId, podcastId, rating) =>
        set((state) => ({
          episodes: {
            ...state.episodes,
            [podcastId]: state.episodes[podcastId]?.map((ep) =>
              ep.id === episodeId ? { ...ep, rating } : ep
            ) || [],
          },
        })),

      addHashtag: (episodeId, podcastId, hashtag) =>
        set((state) => ({
          episodes: {
            ...state.episodes,
            [podcastId]: state.episodes[podcastId]?.map((ep) =>
              ep.id === episodeId
                ? { ...ep, hashtags: [...(ep.hashtags || []), hashtag] }
                : ep
            ) || [],
          },
        })),

      removeHashtag: (episodeId, podcastId, hashtag) =>
        set((state) => ({
          episodes: {
            ...state.episodes,
            [podcastId]: state.episodes[podcastId]?.map((ep) =>
              ep.id === episodeId
                ? { ...ep, hashtags: ep.hashtags?.filter((h) => h !== hashtag) }
                : ep
            ) || [],
          },
        })),
    }),
    {
      name: 'podcast-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
