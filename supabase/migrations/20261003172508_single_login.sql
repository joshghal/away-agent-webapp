-- One active web login per owner account, first login wins.
-- The slot belongs to one Supabase Auth session (the JWT's session_id claim) and
-- is renewed by a heartbeat; it frees up on sign-out or after 10 minutes without
-- one, so a lost or closed device can't lock you out for long. Engines are exempt.
create table public.active_logins (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  session_id   uuid not null,
  device_label text,
  last_seen    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.active_logins enable row level security;
-- No direct access; only the functions below touch it.

create or replace function public.holds_login_slot()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.active_logins a
    where a.user_id = auth.uid()
      and a.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and a.last_seen > now() - interval '10 minutes'
  );
$$;

-- Data access now additionally requires holding the slot (owners only).
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.user_id = auth.uid()
      and (
        m.role = 'engine'
        or (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2' and public.holds_login_slot())
      )
  );
$$;

-- Claims the slot, or renews it if this session already holds it. Requires a
-- 2FA-verified session so a stolen password alone can't grab the slot and lock
-- you out. Returns who holds it when the claim is refused.
create or replace function public.claim_login(p_device_label text)
returns table (granted boolean, holder_device text, holder_last_seen timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  current_row public.active_logins%rowtype;
begin
  if auth.uid() is null or sid is null then
    raise exception 'not signed in';
  end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception '2FA required';
  end if;
  if not exists (select 1 from public.members where user_id = auth.uid() and role = 'owner') then
    raise exception 'not an owner';
  end if;

  insert into public.active_logins as a (user_id, session_id, device_label, last_seen)
  values (auth.uid(), sid, left(p_device_label, 80), now())
  on conflict (user_id) do update
    set session_id = excluded.session_id,
        device_label = excluded.device_label,
        last_seen = now(),
        created_at = case when a.session_id = excluded.session_id then a.created_at else now() end
    where a.session_id = excluded.session_id
       or a.last_seen < now() - interval '10 minutes';

  select * into current_row from public.active_logins where user_id = auth.uid();
  return query select current_row.session_id = sid, current_row.device_label, current_row.last_seen;
end;
$$;

-- Frees the slot on sign-out (only if this session holds it).
create or replace function public.release_login()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.active_logins
  where user_id = auth.uid()
    and session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

revoke all on function public.holds_login_slot() from public, anon;
revoke all on function public.claim_login(text) from public, anon;
revoke all on function public.release_login() from public, anon;
grant execute on function public.holds_login_slot() to authenticated;
grant execute on function public.claim_login(text) to authenticated;
grant execute on function public.release_login() to authenticated;
