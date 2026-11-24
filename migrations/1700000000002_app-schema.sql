-- Up Migration
-- SPEC §4. P1 subset: no usage/feed_usage/subscriptions/ownership_codes (P2).

create table podcasts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user"(id) on delete cascade,
  feed_url text not null,
  feed_identity text not null,
  title text not null,
  description text not null default '',
  art_url text,
  language text,
  owner_email text,
  attested_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, feed_identity)
);

create table consent_log (
  id bigserial primary key,
  user_id text not null references "user"(id) on delete cascade,
  podcast_id uuid references podcasts(id) on delete cascade,
  kind text not null check (kind in ('attest', 'guest_export')),
  text_version text not null,
  ip text,
  at timestamptz not null default now()
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references podcasts(id) on delete cascade,
  guid text not null,
  title text not null,
  description text not null default '',
  audio_url text not null,
  duration_s integer,
  published_at timestamptz,
  transcript jsonb,
  created_at timestamptz not null default now(),
  unique (podcast_id, guid)
);
create index episodes_podcast_pub_idx on episodes (podcast_id, published_at desc);

create table transcription_jobs (
  episode_id uuid primary key references episodes(id) on delete cascade,
  assemblyai_id text,
  status text not null default 'submitted' check (status in ('submitted', 'completed', 'failed')),
  error text,
  attempts integer not null default 0,
  audio_hours_charged numeric(6,3) not null default 0,
  created_at timestamptz not null default now()
);

create table ebooks (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references podcasts(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  title text not null,
  subtitle text not null default '',
  author text not null default '',
  accent_color text not null default '#1f4e79',
  brief text not null default '',
  status text not null default 'queued' check (status in
    ('queued', 'transcribing', 'outlining', 'awaiting_outline', 'drafting', 'review', 'exported', 'needs_attention')),
  attention_reason text,
  outline jsonb,
  omitted jsonb,
  exported_at timestamptz,
  created_at timestamptz not null default now()
);
create index ebooks_user_idx on ebooks (user_id, created_at desc);

create table ebook_episodes (
  ebook_id uuid not null references ebooks(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  position integer not null,
  primary key (ebook_id, episode_id)
);

create table chapters (
  id uuid primary key default gen_random_uuid(),
  ebook_id uuid not null references ebooks(id) on delete cascade,
  chapter_no integer not null,
  title text not null,
  summary text not null default '',
  segment_ranges jsonb not null default '[]',
  markdown text not null default '',
  prev_markdown text,
  hand_edited boolean not null default false,
  opened boolean not null default false,
  flags jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  lease_until timestamptz,
  attempts integer not null default 0,
  unique (ebook_id, chapter_no)
);

-- Down Migration
drop table chapters, ebook_episodes, ebooks, transcription_jobs, episodes, consent_log, podcasts;
