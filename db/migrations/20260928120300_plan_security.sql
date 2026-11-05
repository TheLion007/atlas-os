-- Atlas OS — row-level security for Plan. See docs/DATABASE.md.
--
-- Extends the exact owner-only pattern every other table already uses
-- (20260921120400_security.sql) — no new security model, no new access path.
do $$
declare
  t text;
begin
  foreach t in array array['plan_details']
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_owner_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated '
        'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
        t || '_owner_all', t
      );
    end if;
  end loop;
end;
$$;
