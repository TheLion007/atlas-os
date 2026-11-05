-- Atlas OS — letting a final deletion clear the work journal.
--
-- `progress_log` is written only by a trigger and the owner may only read it (see
-- 20261031100000_progress_log.sql). When an object is deleted for good, its journal entries must
-- go with it; this function is the one narrow door for that: it removes the caller's own entries
-- for the given objects and nothing else. Idempotent.

create or replace function public.purge_progress(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.progress_log
  where object_id = any (ids) and owner_id = (select auth.uid())
$$;

revoke all on function public.purge_progress(uuid[]) from public, anon;
grant execute on function public.purge_progress(uuid[]) to authenticated;
