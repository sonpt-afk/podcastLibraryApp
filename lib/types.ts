export interface Podcast {
  id: string;
  name: string;
  url: string;
  iconUrl: string;
  episodeCount: number;
  createdAt: Date;
}

export interface Episode {
  id: string;
  podcastId: string;
  title: string;
  iconUrl: string;
  broadcastDate: Date;
  episodeUrl: string;
  isFavorite: boolean;
  rating?: number;
  hashtags?: string[];
}

export interface PodcastStore {
  podcasts: Podcast[];
  episodes: { [podcastId: string]: Episode[] };
  addPodcast: (podcast: Omit<Podcast, 'id' | 'createdAt'>) => void;
  removePodcast: (id: string) => void;
  setEpisodes: (podcastId: string, episodes: Episode[]) => void;
  toggleFavorite: (episodeId: string, podcastId: string) => void;
  updateRating: (episodeId: string, podcastId: string, rating: number) => void;
  addHashtag: (episodeId: string, podcastId: string, hashtag: string) => void;
  removeHashtag: (episodeId: string, podcastId: string, hashtag: string) => void;
}
