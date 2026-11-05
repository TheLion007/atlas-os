-- Atlas OS — row-level security for Memory and tags. See docs/DATABASE.md and ADR 0002.
--
-- Extends the exact owner-only pattern every other table already uses (20260921120400_security.sql)
-- — no new security model, no new access path (ADR 0002 §15).
do $$
declare
  t text;
begin
  foreach t in array array['memory_details', 'tags', 'object_tags']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      t || '_owner_all', t
    );
  end loop;
end;
$$;
