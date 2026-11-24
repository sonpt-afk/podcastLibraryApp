-- Up Migration
-- Pipeline bookkeeping not in SPEC §4: per-Episode map results, durable stage retry counter, regenerate instruction.

alter table ebooks
  add column maps jsonb not null default '{}',
  add column stage_attempts integer not null default 0;

alter table chapters add column instruction text;

-- Down Migration
alter table chapters drop column instruction;
alter table ebooks drop column stage_attempts, drop column maps;
