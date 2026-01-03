'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { usePodcastStore } from '@/lib/store';

export function AddPodcastDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const addPodcast = usePodcastStore((state) => state.addPodcast);

  const handleSave = async () => {
    setError('');

    // Validate URL
    if (!url.startsWith('https://www.podbean.com/podcast-detail/')) {
      setError('URL must start with https://www.podbean.com/podcast-detail/');
      return;
    }

    setIsLoading(true);

    try {
      // Call API to scrape podcast details
      const response = await fetch('/api/podcasts/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          setError('Podcast not found. Please check the URL.');
          return;
        }
        throw new Error('Failed to add podcast');
      }

      const data = await response.json();

      addPodcast({
        name: data.name,
        url: data.url,
        iconUrl: data.iconUrl,
        episodeCount: data.episodeCount,
      });

      setUrl('');
      setOpen(false);
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setUrl('');
    setError('');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          className="rounded-full"
          title="Add a new podcast"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Podcast</DialogTitle>
          <DialogDescription>
            Enter the Podbean URL of the podcast you want to add to your library.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Input
              placeholder="https://www.podbean.com/podcast-detail/..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError('');
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading || !url}>
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
