-- Coordinator: a cloud planner (the `coordinator` Edge Function, using OpenRouter)
-- turns a goal into tasks; devices claim tasks they can run and report results.
--
-- Trust model:
--   * Only the owner creates goals and talks to the coordinator.
--   * The coordinator writes tasks through the service role, but the rules below
--     (no bypass, work goals only on devices tagged "work", real dependencies)
--     are enforced here in the database, so a confused or prompt-injected model
--     can't get around them.
--   * Engines never insert or edit tasks directly: they claim, heartbeat and report
--     only through the security-definer functions at the bottom, and only for
--     their own engine ids.

-- ---------------------------------------------------------------- engines
alter table public.engines
  add column capabilities  text[]  not null default '{}',   -- e.g. ios_sim, android_emulator, playwright, gpu
  add column tags          text[]  not null default '{}',   -- e.g. personal, work
  add column tasks_enabled boolean not null default false,
  add column task_slots    integer not null default 1,
  add column git_push      boolean not null default false;  -- may push task branches to origin

-- ------------------------------------------------------------------ goals
create table public.goals (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (length(title) between 1 and 4000),
  status             text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  work               boolean not null default false,          -- employer work: stricter model + devices
  summary            jsonb,                                   -- compacted older thread
  summarized_through bigint not null default 0,               -- last goal_messages.id folded into summary
  locked_until       timestamptz,                             -- one coordinator run per goal at a time
  wake_pending       boolean not null default false,
  cost_usd           numeric(12, 6) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function public.touch_updated_at();

-- The coordinator thread. content shapes:
--   user / event: {"text": "..."}
--   assistant:    {"text": "...", "tool_calls": [OpenAI tool_call, ...]}
--   tool:         {"tool_call_id": "...", "name": "...", "text": "..."}
create table public.goal_messages (
  id         bigint generated always as identity primary key,
  goal_id    uuid not null references public.goals (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant', 'tool', 'event')),
  content    jsonb not null,
  created_at timestamptz not null default now()
);

create index goal_messages_goal_idx on public.goal_messages (goal_id, id);

-- ------------------------------------------------------------------ tasks
create sequence public.task_ref_seq;

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text not null unique default ('t' || nextval('public.task_ref_seq')),
  goal_id             uuid not null references public.goals (id) on delete cascade,
  task_type           text not null check (task_type in ('implement', 'review', 'test', 'check', 'fix', 'open_pr', 'other')),
  instructions        text not null check (length(instructions) between 1 and 8000),
  acceptance          text not null check (length(acceptance) between 1 and 2000),
  repo                text not null check (repo ~ '^[A-Za-z0-9._-]{1,100}$'),  -- folder name, resolved per device
  target_engine       text references public.engines (id) on delete set null,
  required_capability text,
  depends_on          uuid[] not null default '{}',
  -- Never bypassPermissions: shell commands in a task always ask the owner.
  permission_mode     text not null default 'default' check (permission_mode in ('default', 'acceptEdits', 'plan')),
  status              text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  needs_approval      boolean not null default false,
  engine_id           text references public.engines (id) on delete set null,  -- device that ran it
  project_path        text,
  worktree            text,
  base_branch         text,
  branch              text,
  pushed              boolean not null default false,
  session_id          text,
  result              text,
  error               text,
  created_by          text not null default 'coordinator',
  created_at          timestamptz not null default now(),
  claimed_at          timestamptz,
  heartbeat_at        timestamptz,
  finished_at         timestamptz
);

create index tasks_goal_idx on public.tasks (goal_id, created_at);
create index tasks_queue_idx on public.tasks (status, created_at);

-- Rules that hold whoever writes the row (coordinator, owner, or a bug).
create function public.validate_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  goal_row public.goals%rowtype;
  missing  integer;
begin
  select * into goal_row from public.goals where id = new.goal_id;
  if not found then
    raise exception 'unknown goal %', new.goal_id;
  end if;
  if tg_op = 'INSERT' and goal_row.status <> 'active' then
    raise exception 'goal is %, not active', goal_row.status;
  end if;
  if new.target_engine is not null and goal_row.work
     and not exists (select 1 from public.engines e where e.id = new.target_engine and 'work' = any (e.tags)) then
    raise exception 'work goals may only run on devices tagged "work" (% is not)', new.target_engine;
  end if;
  select count(*) into missing
    from unnest(new.depends_on) d
   where not exists (select 1 from public.tasks t where t.id = d and t.goal_id = new.goal_id);
  if missing > 0 then
    raise exception 'depends_on must reference tasks of the same goal';
  end if;
  if new.id = any (new.depends_on) then
    raise exception 'a task cannot depend on itself';
  end if;
  return new;
end;
$$;

create trigger tasks_validate
  before insert or update of goal_id, target_engine, depends_on on public.tasks
  for each row execute function public.validate_task();

-- ------------------------------------------------------------------- RLS
alter table public.goals         enable row level security;
alter table public.goal_messages enable row level security;
alter table public.tasks         enable row level security;

create policy "owner manages goals" on public.goals
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "owner reads thread" on public.goal_messages
  for select to authenticated using (public.is_owner());
-- The owner only ever adds their own words; everything else is written by the coordinator.
create policy "owner writes user messages" on public.goal_messages
  for insert to authenticated with check (public.is_owner() and role = 'user');

create policy "owner reads tasks" on public.tasks
  for select to authenticated using (public.is_owner());
create policy "owner updates tasks" on public.tasks
  for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owner deletes tasks" on public.tasks
  for delete to authenticated using (public.is_owner());
-- Engines see what they could claim or are running (for Realtime wake-ups), nothing else.
create policy "engine sees its queue" on public.tasks
  for select to authenticated
  using (
    public.is_engine()
    and (
      engine_id in (select public.my_engine_ids())
      or (status = 'queued' and (target_engine is null or target_engine in (select public.my_engine_ids())))
    )
  );

alter publication supabase_realtime add table public.goals, public.goal_messages, public.tasks;

-- ------------------------------------------------------ engine functions
-- Repo folder name of a project path ('/Users/x/code/portal' -> 'portal').
create function public.repo_name(p_path text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(rtrim(p_path, '/'), '^.*/', ''));
$$;

-- Atomically hands the calling engine its next runnable task, or nothing.
create function public.claim_task(p_engine_id text)
returns table (
  id uuid, ref text, goal_id uuid, goal_title text, task_type text, instructions text, acceptance text,
  repo text, permission_mode text, project_path text, base_branch text, base_pushed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  eng  public.engines%rowtype;
  pick public.tasks%rowtype;
  path text;
  base public.tasks%rowtype;
begin
  if not (public.is_engine() and p_engine_id in (select public.my_engine_ids())) then
    raise exception 'not your engine';
  end if;
  select * into eng from public.engines where engines.id = p_engine_id;
  if not eng.tasks_enabled then
    return;
  end if;
  if (select count(*) from public.tasks t where t.engine_id = p_engine_id and t.status = 'running') >= eng.task_slots then
    return;
  end if;

  select t.* into pick
    from public.tasks t
    join public.goals g on g.id = t.goal_id
   where t.status = 'queued'
     and g.status = 'active'
     and (t.target_engine = p_engine_id
          or (t.target_engine is null and (t.required_capability is null or t.required_capability = any (eng.capabilities))))
     and (not g.work or 'work' = any (eng.tags))
     and exists (select 1 from public.engine_projects ep
                  where ep.engine_id = p_engine_id and public.repo_name(ep.project_path) = lower(t.repo))
     -- every dependency finished successfully
     and not exists (select 1 from public.tasks d where d.id = any (t.depends_on) and d.status <> 'done')
     -- an unpushed dependency branch only exists on the device that made it
     and not exists (select 1 from public.tasks d
                      where d.id = any (t.depends_on) and d.branch is not null and not d.pushed
                        and d.engine_id is distinct from p_engine_id)
   order by t.created_at
   limit 1
   for update of t skip locked;
  if not found then
    return;
  end if;

  -- The matching folder this device used most recently.
  select ep.project_path into path
    from public.engine_projects ep
    left join public.sessions s on s.engine_id = ep.engine_id and s.project_path = ep.project_path
   where ep.engine_id = p_engine_id and public.repo_name(ep.project_path) = lower(pick.repo)
   group by ep.project_path
   order by max(s.last_message_at) desc nulls last, length(ep.project_path)
   limit 1;

  -- Build on the newest finished dependency that left a branch.
  select d.* into base
    from public.tasks d
   where d.id = any (pick.depends_on) and d.branch is not null
   order by d.finished_at desc nulls last
   limit 1;

  update public.tasks t
     set status = 'running', engine_id = p_engine_id, project_path = path, base_branch = base.branch,
         claimed_at = now(), heartbeat_at = now(), error = null
   where t.id = pick.id;

  return query
    select pick.id, pick.ref, pick.goal_id, (select g.title from public.goals g where g.id = pick.goal_id),
           pick.task_type, pick.instructions, pick.acceptance, pick.repo, pick.permission_mode,
           path, base.branch, coalesce(base.pushed, false);
end;
$$;

-- Engine reports progress on a task it is running. Returns the task's current
-- status so the engine notices a cancellation.
create function public.task_heartbeat(
  p_task_id uuid, p_needs_approval boolean default false, p_session_id text default null,
  p_worktree text default null, p_branch text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  update public.tasks t
     set heartbeat_at = now(),
         needs_approval = p_needs_approval,
         session_id = coalesce(p_session_id, t.session_id),
         worktree = coalesce(p_worktree, t.worktree),
         branch = coalesce(p_branch, t.branch)
   where t.id = p_task_id
     and t.engine_id in (select public.my_engine_ids())
     and public.is_engine()
  returning t.status into st;
  if st is null then
    raise exception 'not your task';
  end if;
  return st;
end;
$$;

-- Engine finishes a task. Leaves a note in the goal's thread and flags the goal
-- for the coordinator; the engine then pokes the Edge Function to wake it.
create function public.report_task(
  p_task_id uuid, p_status text, p_result text default null, p_error text default null,
  p_branch text default null, p_pushed boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks%rowtype;
begin
  if p_status not in ('done', 'failed') then
    raise exception 'status must be done or failed';
  end if;
  update public.tasks x
     set status = p_status,
         result = left(p_result, 6000),
         error = left(p_error, 2000),
         branch = coalesce(p_branch, x.branch),
         pushed = p_pushed,
         needs_approval = false,
         finished_at = now()
   where x.id = p_task_id
     and x.status = 'running'
     and x.engine_id in (select public.my_engine_ids())
     and public.is_engine()
  returning x.* into t;
  if not found then
    return;  -- already finished or cancelled
  end if;
  insert into public.goal_messages (goal_id, role, content)
  values (t.goal_id, 'event', jsonb_build_object('text',
    format('[event] %s (%s) %s on %s%s: %s',
      t.ref, t.task_type, upper(p_status), t.engine_id,
      case when t.branch is not null then format(' [branch %s%s]', t.branch, case when t.pushed then ', pushed' else '' end) else '' end,
      coalesce(left(coalesce(p_result, p_error), 1500), '(no report)'))));
  update public.goals set wake_pending = true where id = t.goal_id;
end;
$$;

-- Lets an engine wake the coordinator only for goals it actually worked on.
create function public.engine_worked_on(p_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_engine() and exists (
    select 1 from public.tasks t where t.goal_id = p_goal_id and t.engine_id in (select public.my_engine_ids())
  );
$$;

-- One coordinator run per goal: returns true if the caller got the lock.
create function public.coordinator_lock(p_goal_id uuid, p_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  got boolean;
begin
  update public.goals
     set locked_until = now() + make_interval(secs => p_seconds), wake_pending = false
   where id = p_goal_id and (locked_until is null or locked_until < now())
  returning true into got;
  if not coalesce(got, false) then
    update public.goals set wake_pending = true where id = p_goal_id;
  end if;
  return coalesce(got, false);
end;
$$;

-- Tasks whose device stopped heartbeating are failed so the coordinator can react.
create function public.fail_stale_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  t record;
begin
  for t in
    update public.tasks x
       set status = 'failed', error = 'device stopped responding while running this task', finished_at = now()
     where x.status = 'running' and x.heartbeat_at < now() - interval '10 minutes'
    returning x.goal_id, x.ref, x.engine_id
  loop
    n := n + 1;
    insert into public.goal_messages (goal_id, role, content)
    values (t.goal_id, 'event', jsonb_build_object('text',
      format('[event] %s FAILED on %s: device stopped responding while running it', t.ref, t.engine_id)));
    update public.goals set wake_pending = true where id = t.goal_id;
  end loop;
  return n;
end;
$$;

revoke all on function public.validate_task() from public, anon;
revoke all on function public.repo_name(text) from public, anon;
revoke all on function public.claim_task(text) from public, anon;
revoke all on function public.task_heartbeat(uuid, boolean, text, text, text) from public, anon;
revoke all on function public.report_task(uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.engine_worked_on(uuid) from public, anon;
revoke all on function public.coordinator_lock(uuid, integer) from public, anon, authenticated;
revoke all on function public.fail_stale_tasks() from public, anon, authenticated;
grant execute on function public.repo_name(text) to authenticated;
grant execute on function public.claim_task(text) to authenticated;
grant execute on function public.task_heartbeat(uuid, boolean, text, text, text) to authenticated;
grant execute on function public.report_task(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.engine_worked_on(uuid) to authenticated;
grant execute on function public.coordinator_lock(uuid, integer) to service_role;
grant execute on function public.fail_stale_tasks() to service_role;
