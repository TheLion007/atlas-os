-- Atlas OS — sub-tasks. See docs/DATABASE.md.
--
-- `contains`: a task may hold tasks (its sub-tasks). The single-parent constraint and the cycle
-- check on `contains` (20260921120200_edges.sql) already apply, so a sub-task has one parent task
-- and a task can never end up inside itself. Idempotent: applied to existing local databases when
-- they open, and to fresh ones with every other migration.
insert into public.edge_rules (kind, from_type, to_type)
values ('contains'::public.edge_kind, 'task'::public.object_type, 'task'::public.object_type)
on conflict (kind, from_type, to_type) do nothing;
