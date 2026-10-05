-- Recurring goals ("schedules"): a prompt plus a cron expression. A database job
-- checks every minute which schedules are due, creates a goal for each (as if
-- the owner had typed it) and wakes the coordinator. Runs while devices sleep;
-- tasks simply queue until one is online.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------ cron matching
-- One field of a 5-field cron expression: supports *, lists (1,5), ranges (1-5)
-- and steps (*/15, 1-30/5).
create or replace function public.cron_field_matches(field text, val int, lo int, hi int)
returns boolean language plpgsql immutable as $$
declare
  part text; stepn int; a int; b int;
begin
  foreach part in array string_to_array(field, ',') loop
    stepn := 1;
    if position('/' in part) > 0 then
      stepn := split_part(part, '/', 2)::int;
      part := split_part(part, '/', 1);
      if stepn < 1 then raise exception 'bad step'; end if;
    end if;
    if part = '*' then
      a := lo; b := hi;
    elsif position('-' in part) > 0 then
      a := split_part(part, '-', 1)::int; b := split_part(part, '-', 2)::int;
    else
      a := part::int;
      b := case when stepn > 1 then hi else a end;
    end if;
    if a < lo or b > hi or a > b then raise exception 'cron value out of range'; end if;
    if val >= a and val <= b and (val - a) % stepn = 0 then return true; end if;
  end loop;
  return false;
end $$;

-- minute hour day-of-month month day-of-week, evaluated in the schedule's timezone.
-- As in standard cron, when both day fields are restricted either one may match.
create or replace function public.cron_matches(expr text, ts timestamptz, tz text)
returns boolean language plpgsql stable as $$
declare
  f text[]; l timestamp := ts at time zone tz;
  dow int; dom_ok boolean; dow_ok boolean;
begin
  f := regexp_split_to_array(btrim(expr), '\s+');
  if array_length(f, 1) <> 5 then raise exception 'cron needs 5 fields'; end if;
  dow := extract(dow from l)::int;
  dom_ok := public.cron_field_matches(f[3], extract(day from l)::int, 1, 31);
  dow_ok := public.cron_field_matches(f[5], dow, 0, 7)
            or (dow = 0 and public.cron_field_matches(f[5], 7, 0, 7));
  return public.cron_field_matches(f[1], extract(minute from l)::int, 0, 59)
     and public.cron_field_matches(f[2], extract(hour from l)::int, 0, 23)
     and public.cron_field_matches(f[4], extract(month from l)::int, 1, 12)
     and case when f[3] <> '*' and f[5] <> '*' then dom_ok or dow_ok else dom_ok and dow_ok end;
end $$;

-- ------------------------------------------------------------------ tables
create table public.schedules (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  prompt          text not null check (char_length(prompt) between 1 and 4000),
  cron            text not null,
  timezone        text not null default 'Asia/Jakarta',
  work            boolean not null default false,
  enabled         boolean not null default true,
  skip_if_running boolean not null default true,
  last_run_at     timestamptz,
  created_at      timestamptz not null default now()
);

alter table public.goals add column schedule_id uuid references public.schedules (id) on delete set null;

-- Rejects a malformed cron expression or unknown timezone at write time.
create or replace function public.validate_schedule() returns trigger
language plpgsql as $$
begin
  perform now() at time zone new.timezone;
  perform public.cron_matches(new.cron, now(), new.timezone);
  return new;
exception when others then
  raise exception 'invalid schedule (cron "%" / timezone "%"): %', new.cron, new.timezone, sqlerrm;
end $$;

create trigger schedules_validate before insert or update on public.schedules
  for each row execute function public.validate_schedule();

alter table public.schedules enable row level security;
create policy "owner manages schedules" on public.schedules
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- ------------------------------------------------------------------ runner
-- The coordinator is woken the same way tests wake it: an internal secret kept in
-- Vault (coordinator_wake_secret) plus the public anon key for the API gateway.
create or replace function public.run_due_schedules() returns integer
language plpgsql security definer set search_path = public, extensions, vault as $$
declare
  s record; g uuid; n int := 0;
  wake text; anon text; base text;
begin
  select decrypted_secret into wake from vault.decrypted_secrets where name = 'coordinator_wake_secret';
  select decrypted_secret into anon from vault.decrypted_secrets where name = 'coordinator_anon_key';
  select decrypted_secret into base from vault.decrypted_secrets where name = 'coordinator_url';
  if wake is null or anon is null or base is null then
    raise warning 'schedules: vault secrets missing, nothing run';
    return 0;
  end if;

  for s in
    select * from public.schedules
    where enabled and (last_run_at is null or last_run_at < date_trunc('minute', now()))
  loop
    begin
      if not public.cron_matches(s.cron, now(), s.timezone) then continue; end if;
      -- Marked first so a slow or failing run is never retried within the same minute.
      update public.schedules set last_run_at = now() where id = s.id;
      if s.skip_if_running and exists (
        select 1 from public.goals where schedule_id = s.id and status = 'active'
      ) then continue; end if;

      insert into public.goals (title, work, schedule_id)
      values (left(s.name || ' · ' || to_char(now() at time zone s.timezone, 'YYYY-MM-DD HH24:MI'), 200), s.work, s.id)
      returning id into g;
      insert into public.goal_messages (goal_id, role, content)
      values (g, 'user', jsonb_build_object('text', s.prompt));

      perform net.http_post(
        url := base || '/functions/v1/coordinator',
        headers := jsonb_build_object(
          'Content-Type', 'application/json', 'apikey', anon,
          'Authorization', 'Bearer ' || anon, 'X-Test-Secret', wake),
        body := jsonb_build_object('goal_id', g));
      n := n + 1;
    exception when others then
      raise warning 'schedule % failed: %', s.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;

revoke all on function public.run_due_schedules() from public, anon, authenticated;
revoke all on function public.cron_matches(text, timestamptz, text) from public, anon;
revoke all on function public.cron_field_matches(text, int, int, int) from public, anon;
grant execute on function public.cron_matches(text, timestamptz, text) to authenticated;

select cron.schedule('run-schedules', '* * * * *', $$select public.run_due_schedules()$$);
