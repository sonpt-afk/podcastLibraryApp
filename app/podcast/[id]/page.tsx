'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/components/api-fetch';

type Episode = { id: string; title: string; durationS: number | null; publishedAt: string | null };
type Data = { podcast: { id: string; title: string; description: string | null; ebookId: string | null }; episodes: Episode[] };

const MAX_S = 6 * 3600;

export default function PodcastPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [brief, setBrief] = useState('');
  const q = useQuery({ queryKey: ['podcast', id], queryFn: () => api<Data>(`/api/podcasts/${id}`) });
  const create = useMutation({
    mutationFn: () => api<{ id: string }>('/api/ebooks', 'POST', { podcastId: id, episodeIds: [...picked], brief }),
    onSuccess: (r) => router.push(`/ebook/${r.id}`),
  });

  if (q.error) return <main className="p-4 text-red-600">{q.error.message}</main>;
  if (!q.data) return <main className="p-4">Loading...</main>;
  const { podcast, episodes } = q.data;
  const totalS = episodes.filter((e) => picked.has(e.id)).reduce((s, e) => s + (e.durationS ?? 0), 0);
  const over = totalS > MAX_S;
  const toggle = (eid: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(eid)) n.add(eid);
      return n;
    });

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <Link href="/" className="text-sm underline">Back</Link>
      <h1 className="text-2xl font-bold">{podcast.title}</h1>
      {podcast.ebookId && (
        <Link className="underline" href={`/ebook/${podcast.ebookId}`}>Open the ebook for this podcast</Link>
      )}
      {episodes.length === 0 && <p className="text-sm text-gray-500">No episodes in this feed.</p>}
      <ul className="divide-y rounded-md border">
        {episodes.map((e) => (
          <li key={e.id}>
            <label className="flex items-start gap-2 px-3 py-2 text-sm">
              <input type="checkbox" data-testid="episode-checkbox" className="mt-1" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
              <span className="flex-1">{e.title}</span>
              <span className="text-gray-500">{e.durationS ? `${Math.round(e.durationS / 60)} min` : '?'}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className={over ? 'text-sm text-red-600' : 'text-sm'}>
        Selected: {picked.size} episodes, {(totalS / 3600).toFixed(2)} h of 6 h max
      </p>
      <textarea className="w-full rounded-md border p-2 text-sm" data-testid="brief" rows={3} placeholder="Brief (optional): what should the ebook be about?" value={brief} onChange={(e) => setBrief(e.target.value)} />
      <button className="rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50" data-testid="create-ebook" disabled={!picked.size || over || create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? 'Creating...' : 'Create ebook'}
      </button>
      {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
    </main>
  );
}
