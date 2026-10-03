-- Which physical machine an engine is. fingerprint is a salted SHA-256 of the
-- hardware ID (never the raw ID): an engine refuses to start if its login is
-- reused on a different machine than the one it was first registered from.
alter table public.engines
  add column fingerprint text,
  add column device_name text,
  add column model       text,
  add column platform    text;
