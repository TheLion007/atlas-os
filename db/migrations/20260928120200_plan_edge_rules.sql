-- Atlas OS — edge_rules for Plan. See docs/DATABASE.md.
--
-- Runs after 'plan' exists (previous migration, its own transaction).
--
-- `references` and `estimates` are ANY-typed; `about`/`derived_from` accept any object from a
-- memory; `located_at` accepts every locatable object. Extend them to the new type, exactly as
-- was done for memory (20260923100300_memory_edge_rules.sql) and transaction
-- (20260924100100_finance_documents.sql). `on conflict do nothing` keeps these re-runnable.

-- `contains`: a plan groups several standalone projects (never sub-projects/tasks directly).
-- Combined with the existing single-parent constraint on `contains`
-- (edges_single_parent_idx, 20260921120200_edges.sql), this gives "one plan per project" for
-- free — no new validation.
insert into public.edge_rules (kind, from_type, to_type)
values ('contains'::public.edge_kind, 'plan'::public.object_type, 'project'::public.object_type)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, f.x, 'plan'::public.object_type
from unnest(enum_range(null::public.object_type)) as f (x)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, 'plan'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
values
  ('estimates'::public.edge_kind, 'estimate'::public.object_type, 'plan'::public.object_type),
  ('about'::public.edge_kind, 'memory'::public.object_type, 'plan'::public.object_type),
  ('derived_from'::public.edge_kind, 'memory'::public.object_type, 'plan'::public.object_type),
  ('located_at'::public.edge_kind, 'plan'::public.object_type, 'location'::public.object_type)
on conflict (kind, from_type, to_type) do nothing;
