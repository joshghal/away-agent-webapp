-- Least privilege for engines. Until now every member (owner or engine) had full
-- access to every table and could read every Realtime broadcast. A compromised
-- device could then read Claude sign-in links and codes meant for another
-- device, send commands to other devices, or tamper with their records.
-- After this: only a 2FA-verified owner holding the login slot can send commands
-- and receive broadcasts; each engine touches only its own rows.

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.user_id = auth.uid()
      and m.role = 'owner'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      and public.holds_login_slot()
  );
$$;

create or replace function public.is_engine()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.role = 'engine');
$$;

-- Engine ids registered by the calling engine account.
create or replace function public.my_engine_ids()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.engines where user_id = auth.uid();
$$;

revoke all on function public.is_owner() from public, anon;
revoke all on function public.is_engine() from public, anon;
revoke all on function public.my_engine_ids() from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_engine() to authenticated;
grant execute on function public.my_engine_ids() to authenticated;

-- ---------------------------------------------------------------- engines
drop policy "members full access" on public.engines;
create policy "members read engines" on public.engines
  for select to authenticated using (public.is_member());
create policy "engine registers itself" on public.engines
  for insert to authenticated with check (public.is_owner() or (public.is_engine() and user_id = auth.uid()));
create policy "engine updates itself" on public.engines
  for update to authenticated
  using (public.is_owner() or (public.is_engine() and user_id = auth.uid()))
  with check (public.is_owner() or (public.is_engine() and user_id = auth.uid()));
create policy "owner deletes engines" on public.engines
  for delete to authenticated using (public.is_owner());

-- -------------------------------------------------------- engine_projects
drop policy "members full access" on public.engine_projects;
create policy "members read engine projects" on public.engine_projects
  for select to authenticated using (public.is_member());
create policy "engine manages own projects" on public.engine_projects
  for all to authenticated
  using (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())))
  with check (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())));

-- --------------------------------------------------------------- sessions
drop policy "members full access" on public.sessions;
create policy "members read sessions" on public.sessions
  for select to authenticated using (public.is_member());
create policy "engine writes own sessions" on public.sessions
  for insert to authenticated
  with check (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())));
create policy "engine updates own sessions" on public.sessions
  for update to authenticated
  using (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())))
  with check (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())));
create policy "owner deletes sessions" on public.sessions
  for delete to authenticated using (public.is_owner());

-- --------------------------------------------------------- session_events
drop policy "members full access" on public.session_events;
create policy "members read events" on public.session_events
  for select to authenticated using (public.is_member());
create policy "engine writes own events" on public.session_events
  for insert to authenticated
  with check (
    public.is_owner()
    or (public.is_engine() and session_id in (select s.id from public.sessions s where s.engine_id in (select public.my_engine_ids())))
  );
create policy "engine deletes own events" on public.session_events
  for delete to authenticated
  using (
    public.is_owner()
    or (public.is_engine() and session_id in (select s.id from public.sessions s where s.engine_id in (select public.my_engine_ids())))
  );

-- --------------------------------------------------------------- commands
-- Only the owner sends commands. An engine sees and finishes only its own inbox.
drop policy "members full access" on public.commands;
create policy "owner reads commands, engine its inbox" on public.commands
  for select to authenticated
  using (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())));
create policy "only owner sends commands" on public.commands
  for insert to authenticated with check (public.is_owner());
create policy "engine finishes own commands" on public.commands
  for update to authenticated
  using (public.is_engine() and engine_id in (select public.my_engine_ids()))
  with check (public.is_engine() and engine_id in (select public.my_engine_ids()));
create policy "engine prunes own commands" on public.commands
  for delete to authenticated
  using (public.is_owner() or (public.is_engine() and engine_id in (select public.my_engine_ids())));

-- --------------------------------------------------------------- Realtime
-- Topics:
--   "presence"          who is online (engines and browser tabs). Nothing else is
--                       sent here; every member may join it.
--   "engine:<id>"       that device's output to your browser (streaming text,
--                       tool results, sign-in links). Only that device may join or
--                       send; only the owner may read.
-- So a device can never hear another device's output, sign-in links or codes.
drop policy "members receive realtime" on realtime.messages;
drop policy "members send realtime" on realtime.messages;
create policy "realtime read" on realtime.messages
  for select to authenticated
  using (
    public.is_owner()
    or (
      public.is_engine()
      and (realtime.topic() = 'presence' or realtime.topic() in (select 'engine:' || e from public.my_engine_ids() as e))
    )
  );
create policy "realtime write" on realtime.messages
  for insert to authenticated
  with check (
    (public.is_owner() and realtime.topic() = 'presence')
    or (
      public.is_engine()
      and (realtime.topic() = 'presence' or realtime.topic() in (select 'engine:' || e from public.my_engine_ids() as e))
    )
  );
