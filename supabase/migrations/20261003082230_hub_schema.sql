-- AwayAgent hub schema.
-- The hub (Vercel UI + this database) is always on and does no AI work.
-- Engines (devices running `claude -p`) connect outbound, pick up `commands`,
-- and write durable results into `session_events` / `sessions`.
-- Token-by-token streaming does NOT go through tables: engines send it over
-- Realtime Broadcast on a private channel, and only finished items are stored.

-- ---------------------------------------------------------------------------
-- Access: only accounts listed in `members` can touch anything.
-- Sign-ups are disabled; you add yourself and one account per engine by hand.
-- ---------------------------------------------------------------------------
create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'engine')),
  label      text,
  created_at timestamptz not null default now()
);

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = auth.uid());
$$;

revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Engines: one row per device. Liveness = recent last_seen_at (heartbeat);
-- the UI also uses Realtime Presence for instant online/offline.
-- ---------------------------------------------------------------------------
create table public.engines (
  id           text primary key,              -- stable device name, e.g. 'joshua-mbp'
  user_id      uuid not null default auth.uid() references auth.users (id),
  hostname     text,
  home_dir     text,
  version      text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Which project directories exist on which engine (reported on engine start),
-- so the UI knows where a session can run.
create table public.engine_projects (
  engine_id    text not null references public.engines (id) on delete cascade,
  project_path text not null,
  primary key (engine_id, project_path)
);

-- ---------------------------------------------------------------------------
-- Sessions: mirrors a `claude` CLI session. engine_id + lease_expires_at is the
-- single-writer lock — only the leasing engine may append to a session.
-- ---------------------------------------------------------------------------
create table public.sessions (
  id               text primary key,          -- claude CLI session id
  project_path     text not null,
  title            text,
  engine_id        text references public.engines (id) on delete set null,
  lease_expires_at timestamptz,
  status           text not null default 'idle' check (status in ('idle', 'processing', 'permission')),
  unread           boolean not null default false,
  pending_approval jsonb,                     -- approval_request payload while status = 'permission'
  message_count    integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index sessions_project_recent_idx on public.sessions (project_path, updated_at desc);

-- Durable transcript items (HistoryItem shapes + turn_complete), in order.
create table public.session_events (
  id         bigint generated always as identity primary key,
  session_id text not null references public.sessions (id) on delete cascade,
  type       text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index session_events_session_idx on public.session_events (session_id, id);

-- ---------------------------------------------------------------------------
-- Commands: UI -> engine inbox. payload is a ClientMessage from ws-protocol.ts.
-- Durable, so a command sent while an engine is reconnecting isn't lost.
-- ---------------------------------------------------------------------------
create table public.commands (
  id           uuid primary key default gen_random_uuid(),
  engine_id    text not null references public.engines (id) on delete cascade,
  project_path text,
  session_id   text,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz
);

create index commands_inbox_idx on public.commands (engine_id, status, created_at);

-- ---------------------------------------------------------------------------
-- Shared context: goals, decisions, notes, per-device status — readable by
-- every engine and the UI. project_path null = global context.
-- ---------------------------------------------------------------------------
create table public.context_notes (
  id           uuid primary key default gen_random_uuid(),
  project_path text,
  kind         text not null check (kind in ('goal', 'decision', 'note', 'status')),
  body         text not null,
  author       text not null,                 -- engine id, or 'owner'
  session_id   text references public.sessions (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index context_notes_project_idx on public.context_notes (project_path, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic session lease: succeeds only if the session is free, already held by
-- this engine, or the previous lease expired. Returns whether it was granted.
-- ---------------------------------------------------------------------------
create function public.claim_session(p_session_id text, p_engine_id text, p_ttl_seconds integer default 120)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  granted boolean;
begin
  update public.sessions
     set engine_id = p_engine_id,
         lease_expires_at = now() + make_interval(secs => p_ttl_seconds)
   where id = p_session_id
     and (engine_id is null or engine_id = p_engine_id or lease_expires_at < now())
  returning true into granted;
  return coalesce(granted, false);
end;
$$;

revoke execute on function public.claim_session(text, text, integer) from public, anon;
grant execute on function public.claim_session(text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: members get full access, everyone else gets nothing.
-- ---------------------------------------------------------------------------
alter table public.members         enable row level security;
alter table public.engines         enable row level security;
alter table public.engine_projects enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_events  enable row level security;
alter table public.commands        enable row level security;
alter table public.context_notes   enable row level security;

-- members is managed by hand (SQL editor / service role); users may only see their own row.
create policy "read own membership" on public.members
  for select to authenticated using (user_id = auth.uid());

create policy "members full access" on public.engines
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members full access" on public.engine_projects
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members full access" on public.sessions
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members full access" on public.session_events
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members full access" on public.commands
  for all to authenticated using (public.is_member()) with check (public.is_member());
create policy "members full access" on public.context_notes
  for all to authenticated using (public.is_member()) with check (public.is_member());

-- Private Realtime channels (streaming deltas, presence) are members-only too.
create policy "members receive realtime" on realtime.messages
  for select to authenticated using (public.is_member());
create policy "members send realtime" on realtime.messages
  for insert to authenticated with check (public.is_member());

-- Table changes the UI / engines subscribe to.
alter publication supabase_realtime add table
  public.engines, public.sessions, public.session_events, public.commands, public.context_notes;
