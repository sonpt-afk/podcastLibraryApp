'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/components/api-fetch';

type Range = { from: number; to: number };
type OutlineChapter = { title: string; summary: string; sources: { episodeId: string; ranges: Range[] }[] };
type Chapter = {
  id: string;
  chapterNo: number;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  markdown: string;
  opened: boolean;
  handEdited: boolean;
  flags: { unverifiedNumbers?: string[]; unverifiedNames?: string[] } | null;
  canUndo: boolean;
};
type Progress = {
  status: string;
  attentionReason: string | null;
  episodes: number;
  transcribed: number;
  mapped: number;
  chapters: number;
  chaptersDone: number;
  chaptersFailed: number;
};
type Data = {
  ebook: {
    id: string;
    podcastId: string;
    title: string;
    subtitle: string;
    author: string;
    accentColor: string;
    outline: OutlineChapter[] | null;
    omitted: Record<string, { range: Range; reason: string }[]> | null;
  };
  chapters: Chapter[];
  blockers: { unopened: number; undone: number };
  progress: Progress;
};

const STAGES = ['queued', 'transcribing', 'outlining', 'awaiting_outline', 'drafting', 'review', 'exported'];
const RUNNING = ['queued', 'transcribing', 'outlining', 'drafting'];
const input = 'w-full rounded-md border px-3 py-2 text-sm';
const btn = 'rounded-md bg-black px-3 py-2 text-sm text-white disabled:opacity-50';
const btn2 = 'rounded-md border px-3 py-2 text-sm disabled:opacity-50';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function EbookPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['ebook', id], queryFn: () => api<Data>(`/api/ebooks/${id}`) });
  const refetch = q.refetch;
  const [err, setErr] = useState('');
  const [loopKey, setLoopKey] = useState(0); // bump to restart the loop after an error
  const busy = useRef(false); // strict mode double-mounts effects; never two advance calls at once

  const d = q.data;
  const status = d?.progress.status;
  const draftingLeft = !!d?.chapters.some((c) => c.status === 'pending' || c.status === 'running');
  const active = !!status && (RUNNING.includes(status) || ((status === 'review' || status === 'exported') && draftingLeft));

  useEffect(() => {
    if (!active) return;
    let stop = false;
    (async () => {
      while (!stop) {
        if (!busy.current) {
          busy.current = true;
          try {
            await api(`/api/ebooks/${id}/advance`, 'POST');
            await refetch();
            setErr('');
          } catch (e) {
            setErr((e as Error).message);
            stop = true;
          } finally {
            busy.current = false;
          }
        }
        await sleep(1500);
      }
    })();
    return () => {
      stop = true;
    };
  }, [active, id, refetch, loopKey]);

  // Run an action, show its error inline, then reload.
  async function act(fn: () => Promise<unknown>) {
    try {
      setErr('');
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
    await refetch();
  }

  if (q.error) return <main className="p-4 text-red-600">{q.error.message}</main>;
  if (!d) return <main className="p-4">Loading...</main>;
  const p = d.progress;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <Link href="/" className="text-sm underline">Back</Link>
      <h1 className="text-2xl font-bold">{d.ebook.title || 'Untitled ebook'}</h1>
      <div className="text-sm">
        Status: <span data-testid="ebook-status" className="rounded bg-gray-100 px-2 py-0.5 font-medium">{p.status}</span>
      </div>
      <ol className="flex flex-wrap gap-1 text-xs">
        {STAGES.map((s) => (
          <li key={s} className={`rounded px-2 py-1 ${s === p.status ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'}`}>{s.replace('_', ' ')}</li>
        ))}
      </ol>
      {err && (
        <p className="text-sm text-red-600">
          {err} {active && <button className="underline" onClick={() => setLoopKey((k) => k + 1)}>Resume</button>}
        </p>
      )}

      {RUNNING.includes(p.status) && (
        <section className="space-y-1 text-sm">
          <p>Transcribed {p.transcribed}/{p.episodes} episodes. Mapped {p.mapped}/{p.episodes}. Chapters drafted {p.chaptersDone}/{p.chapters}.</p>
          <p className="text-gray-500">Keep this tab open while it works. If you close it, we will keep going and email you when the draft is ready.</p>
        </section>
      )}
      {p.status === 'needs_attention' && <Attention data={d} id={id} act={act} />}
      {p.status === 'awaiting_outline' && <Outline data={d} id={id} act={act} />}
      {(p.status === 'review' || p.status === 'exported' || (p.status === 'drafting' && d.chapters.length > 0)) && (
        <Review data={d} id={id} act={act} active={active} />
      )}
    </main>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function Attention({ data, id, act }: { data: Data; id: string; act: Act }) {
  const post = (resolution: 'drop' | 'retry') => act(() => api(`/api/ebooks/${id}`, 'POST', { action: 'resolve', resolution }));
  return (
    <section className="space-y-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm">
      <p className="font-medium">Needs attention</p>
      <p>{data.progress.attentionReason ?? 'Something went wrong.'}</p>
      <div className="flex gap-2">
        <button className={btn2} onClick={() => post('retry')}>Retry</button>
        <button className={btn2} onClick={() => post('drop')}>Drop episode</button>
      </div>
      {/* ponytail: GET does not expose the failing episodeId, so drop is sent without one (server needs it, see report) */}
    </section>
  );
}

function Outline({ data, id, act }: { data: Data; id: string; act: Act }) {
  const [ch, setCh] = useState<OutlineChapter[] | null>(null);
  useEffect(() => {
    setCh((cur) => cur ?? data.ebook.outline);
  }, [data.ebook.outline]);
  if (!ch) return <p>Loading outline...</p>;
  const set = (i: number, patch: Partial<OutlineChapter>) => setCh(ch.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, dir: -1 | 1) => {
    const n = [...ch];
    [n[i], n[i + dir]] = [n[i + dir], n[i]];
    setCh(n);
  };
  const omitted = Object.entries(data.ebook.omitted ?? {});
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Outline</h2>
        {ch.map((c, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <input className={input} value={c.title} onChange={(e) => set(i, { title: e.target.value })} />
            <textarea className={input} rows={3} value={c.summary} onChange={(e) => set(i, { summary: e.target.value })} />
            <div className="flex gap-2">
              <button className={btn2} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
              <button className={btn2} disabled={i === ch.length - 1} onClick={() => move(i, 1)}>Down</button>
              <button className={btn2} onClick={() => setCh(ch.filter((_, j) => j !== i))}>Delete</button>
            </div>
          </div>
        ))}
        <button className={btn} data-testid="outline-approve" disabled={!ch.length} onClick={() => act(() => api(`/api/ebooks/${id}`, 'POST', { action: 'approve', chapters: ch }))}>
          Approve outline
        </button>
      </section>
      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-semibold">Left out</h2>
        {omitted.length === 0 && <p className="text-gray-500">Nothing was left out.</p>}
        {omitted.map(([epId, items]) => (
          <div key={epId}>
            <p className="font-medium">Episode {epId.slice(0, 8)}</p>
            <ul className="list-disc pl-5 text-gray-700">
              {items.map((o, i) => (
                <li key={i}>Segments {o.range.from}-{o.range.to}: {o.reason}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function Review({ data, id, act, active }: { data: Data; id: string; act: Act; active: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [instruction, setInstruction] = useState('');
  const [meta, setMeta] = useState({ title: data.ebook.title, subtitle: data.ebook.subtitle, author: data.ebook.author, accent_color: data.ebook.accentColor });
  const cur = data.chapters.find((c) => c.id === sel);
  const curMd = cur?.markdown;
  useEffect(() => {
    if (curMd !== undefined) setDraft(curMd);
  }, [sel, curMd]);

  const post = (a: object) => act(() => api(`/api/chapters/${sel}`, 'POST', a));
  const { unopened, undone } = data.blockers;
  const canExport = !active && unopened === 0 && undone === 0;
  const pdf = `/api/ebooks/${id}/pdf`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <ul className="space-y-1">
          {data.chapters.map((c) => (
            <li key={c.id}>
              <button
                data-testid="chapter-item"
                className={`w-full rounded-md border px-2 py-2 text-left text-sm ${c.id === sel ? 'border-black' : ''}`}
                onClick={() => {
                  setSel(c.id);
                  act(() => api(`/api/chapters/${c.id}`, 'POST', { action: 'open' }));
                }}
              >
                <div>{c.chapterNo}. {c.title}</div>
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  <span className="rounded bg-gray-100 px-1">{c.status}</span>
                  <span className="rounded bg-gray-100 px-1">{c.opened ? 'opened' : 'unopened'}</span>
                  {c.handEdited && <span className="rounded bg-gray-100 px-1">edited</span>}
                  {(c.flags?.unverifiedNumbers?.length || c.flags?.unverifiedNames?.length) ? <span className="rounded bg-amber-100 px-1">flags</span> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-3">
          {!cur && <p className="text-sm text-gray-500">Select a chapter to read and edit it. Open every chapter before exporting.</p>}
          {cur && (
            <>
              {!!cur.flags?.unverifiedNumbers?.length && (
                <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Numbers not found in the transcript: {cur.flags.unverifiedNumbers.join(', ')}</p>
              )}
              {!!cur.flags?.unverifiedNames?.length && (
                <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Names not found in the transcript: {cur.flags.unverifiedNames.join(', ')}</p>
              )}
              {cur.status === 'failed' && <p className="text-sm text-red-600">This chapter failed to draft. Try Regenerate.</p>}
              <textarea className="h-96 w-full rounded-md border p-2 font-mono text-sm" data-testid="chapter-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <button className={btn} data-testid="chapter-save" disabled={draft === cur.markdown} onClick={() => post({ action: 'edit', markdown: draft })}>Save</button>
                <button className={btn2} disabled={!cur.canUndo} onClick={() => post({ action: 'undo' })}>Undo</button>
                <input className="min-w-40 flex-1 rounded-md border px-2 py-2 text-sm" placeholder="Regenerate instruction (optional)" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
                <button className={btn2} onClick={() => post({ action: 'regenerate', instruction: instruction || undefined }).then(() => setInstruction(''))}>Regenerate</button>
              </div>
            </>
          )}
        </div>
      </div>

      <section className="space-y-2 text-sm">
        <button className={btn2} onClick={() => act(() => api(`/api/ebooks/${id}`, 'POST', { action: 'regenerateAll' }))}>Regenerate all</button>
        <span className="ml-2 text-gray-500">Hand-edited chapters are skipped.</span>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Book details</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['title', 'subtitle', 'author'] as const).map((k) => (
            <input key={k} className={input} placeholder={k} value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
          ))}
          <input className="h-10 w-full rounded-md border" type="color" value={meta.accent_color} onChange={(e) => setMeta({ ...meta, accent_color: e.target.value })} />
        </div>
        <button className={btn2} onClick={() => act(() => api(`/api/ebooks/${id}`, 'PATCH', meta))}>Save details</button>
      </section>

      <section className="space-y-2">
        {canExport ? (
          <a className={`${btn} inline-block`} data-testid="export-pdf" href={pdf} download>
            {data.progress.status === 'exported' ? 'Download PDF again' : 'Export PDF'}
          </a>
        ) : (
          <>
            <button className={btn} data-testid="export-pdf" disabled>Export PDF</button>
            <p className="text-sm text-gray-500">
              {active ? 'Chapters are still being drafted. ' : ''}
              {unopened > 0 && `${unopened} chapter(s) not opened yet. `}
              {undone > 0 && `${undone} chapter(s) not drafted.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
