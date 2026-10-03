-- Owners only get data with a 2FA-verified session (aal2), so a stolen password
-- alone is useless. Engine accounts are exempt: they are headless, and their
-- 43-character random passwords never leave each device's Keychain.
-- Every table, Realtime and Storage policy goes through is_member(), so this one
-- change covers them all. "read own membership" stays aal1 so the login screen
-- can tell an owner they still need to complete 2FA.
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
      and (m.role = 'engine' or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
  );
$$;

-- Defense in depth: logged-out visitors (anon) get no table privileges at all, so
-- even a future policy mistake can't expose rows to someone without a login.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
