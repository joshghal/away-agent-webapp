-- The model list each device's own `claude` CLI reports (value, displayName,
-- description). Different CLI versions offer different models, so the app shows
-- the list of the device a session runs on instead of a hardcoded one.
alter table public.engines add column models jsonb;
