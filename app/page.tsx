'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authClient } from '@/lib/auth-client';
import { api } from '@/components/api-fetch';

type Podcast = { id: string; title: string; ebookId: string | null };
type Hit = { collectionId: number; collectionName: string; artistName: string; feedUrl?: string };

const input = 'w-full rounded-md border px-3 py-2 text-sm';
const btn = 'rounded-md bg-black px-4 py-2 text-sm text-white disabled:opacity-50';

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  async function e2e() {
    setErr('');
    // ponytail: try sign-in first, fall back to sign-up (test-only form)
    const a = await authClient.signIn.email({ email, password });
    if (!a.error) return;
    const b = await authClient.signUp.email({ email, password, name: email.split('@')[0] });
    if (b.error) setErr(b.error.message ?? 'Sign-in failed');
  }
  return (
    <div className="space-y-6">
      <p>Turn your podcast episodes into an ebook you can sell.</p>
      <button className={btn} onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}>
        Sign in with Google
      </button>
      {process.env.NEXT_PUBLIC_E2E_AUTH === '1' && (
        <div className="max-w-sm space-y-2">
          <input className={input} data-testid="e2e-email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} data-testid="e2e-password" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className={btn} data-testid="e2e-signin" onClick={e2e}>Sign in / sign up (test)</button>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}

function Search({ onPick }: { onPick: (feedUrl: string) => void }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [msg, setMsg] = useState('');
  async function go() {
    if (!term.trim()) return;
    setMsg('Searching...');
    try {
      // Browser-side on purpose (SPEC §5.1): no server proxy.
      const r = await fetch(`https://itunes.apple.com/search?media=podcast&term=${encodeURIComponent(term)}`);
      const j = (await r.json()) as { results: Hit[] };
      setHits(j.results.filter((h) => h.feedUrl));
      setMsg(j.results.length ? '' : 'No results.');
    } catch {
      setMsg('Apple search failed. Paste the RSS URL instead.');
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className={input} placeholder="Or search Apple Podcasts" value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button className="rounded-md border px-3 text-sm" onClick={go}>Search</button>
      </div>
      {msg && <p className="text-sm text-gray-500">{msg}</p>}
      <ul className="divide-y text-sm">
        {hits.map((h) => (
          <li key={h.collectionId}>
            <button className="w-full py-2 text-left hover:bg-gray-50" onClick={() => { onPick(h.feedUrl!); setHits([]); }}>
              {h.collectionName} <span className="text-gray-500">- {h.artistName}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Home() {
  const router = useRouter();
  const qc = useQueryClient();
  const [feedUrl, setFeedUrl] = useState('');
  const [attested, setAttested] = useState(false);
  const list = useQuery({ queryKey: ['podcasts'], queryFn: () => api<{ podcasts: Podcast[] }>('/api/podcasts') });
  const imp = useMutation({
    mutationFn: () => api<{ podcastId: string }>('/api/podcasts/import', 'POST', { feedUrl, attested }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['podcasts'] });
      router.push(`/podcast/${r.podcastId}`);
    },
  });
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Import a podcast</h2>
        <input className={input} data-testid="import-url" placeholder="RSS feed URL" value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} />
        <Search onPick={setFeedUrl} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="import-attest" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          I own or have rights to this podcast
        </label>
        <button className={btn} data-testid="import-submit" disabled={!feedUrl.trim() || !attested || imp.isPending} onClick={() => imp.mutate()}>
          {imp.isPending ? 'Importing...' : 'Import'}
        </button>
        {imp.error && <p className="text-sm text-red-600">{imp.error.message}</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your podcasts</h2>
        {list.error && <p className="text-sm text-red-600">{list.error.message}</p>}
        {list.data?.podcasts.length === 0 && <p className="text-sm text-gray-500">Nothing yet. Import a feed above.</p>}
        <ul className="divide-y rounded-md border">
          {list.data?.podcasts.map((p) => (
            <li key={p.id}>
              <Link className="block px-3 py-2 hover:bg-gray-50" data-testid="podcast-link" href={p.ebookId ? `/ebook/${p.ebookId}` : `/podcast/${p.id}`}>
                {p.title} {p.ebookId && <span className="text-xs text-gray-500">(ebook)</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function Page() {
  const { data, isPending } = authClient.useSession();
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Podcast to Ebook</h1>
        {data && <button className="text-sm underline" onClick={() => authClient.signOut().then(() => location.reload())}>Sign out</button>}
      </div>
      {isPending ? <p>Loading...</p> : data ? <Home /> : <SignIn />}
    </main>
  );
}
