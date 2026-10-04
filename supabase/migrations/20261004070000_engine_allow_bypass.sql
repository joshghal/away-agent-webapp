-- Whether this device's own config allows "Bypass permissions" (ALLOW_BYPASS_PERMISSIONS=1
-- in its .env.engine). Reported by the engine for display only: the engine itself
-- refuses bypass when its config doesn't allow it, whatever this column says.
alter table public.engines add column allow_bypass boolean not null default false;
