-- Deutsche Reise — versioned full backups (Supabase Auth email user = same account on all devices).
--
-- Prerequisites:
--   • Authentication → enable Email provider (and/or magic links).
--   • Optional: Anonymous — not used for cloud backup anymore.
--
-- Run this in the SQL Editor (new projects: run once).

-- ---------------------------------------------------------------------------
-- Snapshot history (append-only inserts; app prunes oldest beyond retention)
-- ---------------------------------------------------------------------------
create table if not exists public.dr_backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  word_count int not null default 0,
  srs_count int not null default 0,
  story_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists dr_backup_snapshots_user_created_idx
  on public.dr_backup_snapshots (user_id, created_at desc);

alter table public.dr_backup_snapshots enable row level security;

drop policy if exists "snapshots_select_own" on public.dr_backup_snapshots;
drop policy if exists "snapshots_insert_own" on public.dr_backup_snapshots;
drop policy if exists "snapshots_delete_own" on public.dr_backup_snapshots;

create policy "snapshots_select_own"
  on public.dr_backup_snapshots for select
  using (auth.uid() = user_id);

create policy "snapshots_insert_own"
  on public.dr_backup_snapshots for insert
  with check (auth.uid() = user_id);

-- Allow user to delete own rows (used for retention pruning from the client)
create policy "snapshots_delete_own"
  on public.dr_backup_snapshots for delete
  using (auth.uid() = user_id);

grant select, insert, delete on public.dr_backup_snapshots to authenticated;
grant select, insert, delete on public.dr_backup_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- Legacy table (optional): safe to keep; app no longer writes here.
-- You can drop after migrating: drop table if exists public.dr_full_backups;
-- ---------------------------------------------------------------------------

-- Optional one-time migration from old single-row table into first snapshot:
-- insert into public.dr_backup_snapshots (user_id, payload, word_count, srs_count, story_count, created_at)
-- select
--   b.user_id,
--   b.payload,
--   coalesce(jsonb_array_length(b.payload->'words'), 0)::int,
--   coalesce(jsonb_array_length(b.payload->'srs_cards'), 0)::int,
--   coalesce(jsonb_array_length(b.payload->'stories'), 0)::int,
--   b.updated_at
-- from public.dr_full_backups b
-- where not exists (
--   select 1 from public.dr_backup_snapshots s where s.user_id = b.user_id
-- );
