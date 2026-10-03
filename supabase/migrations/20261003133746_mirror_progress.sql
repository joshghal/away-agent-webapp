-- Transcript file mtime as of the last completed mirror. Lets an engine skip
-- unchanged sessions after a restart instead of re-reading every transcript.
alter table public.sessions add column mirrored_mtime timestamptz;
