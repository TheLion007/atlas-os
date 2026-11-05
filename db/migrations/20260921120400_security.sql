-- Atlas OS — row-level security and grants. See docs/DATABASE.md.
--
-- Every table has RLS enabled and an owner-only policy. `anon` gets nothing at all, so the
-- auto-generated Supabase REST API exposes no data even if its public keys leak.

-- Owner-only tables: all commands, own rows only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'objects', 'edges', 'app_settings', 'fx_rates', 'graph_layout',
    'project_details', 'task_details', 'milestone_details', 'scenario_details',
    'estimate_details', 'location_details', 'property_details', 'decision_details',
    'risk_details', 'note_details', 'document_details', 'person_details', 'event_details'
  ]
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

-- Activity log: readable by its owner, written only by the security-definer trigger.
alter table public.activity_log enable row level security;
create policy activity_log_owner_select on public.activity_log
  for select to authenticated using (owner_id = (select auth.uid()));

-- Edge rules: shared reference data, read-only.
alter table public.edge_rules enable row level security;
create policy edge_rules_read on public.edge_rules for select to authenticated using (true);

-- Grants: nothing for anon; authenticated gets only what the policies then narrow.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke all on public.activity_log from authenticated;
grant select on public.activity_log to authenticated;
revoke all on public.edge_rules from authenticated;
grant select on public.edge_rules to authenticated;
