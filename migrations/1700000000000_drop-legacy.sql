-- Up Migration
-- SPEC §4: prototype rows wiped. Listener-era tables (verified empty 2026-11-24) replaced by the new schema.
drop table if exists hashtags, episodes, podcasts cascade;

-- Down Migration
-- Irreversible: legacy schema lived in scripts/init-db.sql (deleted; see git history).
select 1;
