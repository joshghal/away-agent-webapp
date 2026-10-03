-- Sessions only ever run on the engine that holds their transcript on disk
-- (`claude --resume` needs the local .jsonl), so sessions.engine_id means
-- "origin engine" and the lease mechanism is unnecessary.
drop function public.claim_session(text, text, integer);
alter table public.sessions drop column lease_expires_at;

alter table public.sessions
  add column live            boolean not null default false,
  add column last_message_at timestamptz;

create index sessions_recent_idx on public.sessions (last_message_at desc nulls last);

-- Which browser tab sent a command, so the engine can reply to just that tab.
alter table public.commands add column client_id text;

-- Per-engine state the UI shows without asking the device directly.
alter table public.engines
  add column default_project text,
  add column claude_auth     jsonb,
  add column mcp             jsonb,
  add column mcp_checked_at  timestamptz;

-- Nobody subscribes to raw transcript inserts; keep them out of Realtime's WAL work.
alter publication supabase_realtime drop table public.session_events;

-- Screenshots from tool results (too large for Realtime messages and table rows).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transcript-images', 'transcript-images', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

create policy "members read transcript images" on storage.objects
  for select to authenticated using (bucket_id = 'transcript-images' and public.is_member());
create policy "members upload transcript images" on storage.objects
  for insert to authenticated with check (bucket_id = 'transcript-images' and public.is_member());
