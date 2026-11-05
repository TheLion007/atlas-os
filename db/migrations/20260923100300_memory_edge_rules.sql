-- Atlas OS — edge_rules for Memory. See docs/DATABASE.md and ADR 0002.
--
-- Runs after 'memory' and the new edge kinds exist (previous migration, its own transaction).

-- `about`: what a memory concerns. Any object except another memory — a memory-about-a-memory
-- relationship is a `references` edge instead (mirrors ADR 0002 §3's "keep about's semantics
-- crisp").
insert into public.edge_rules (kind, from_type, to_type)
select 'about'::public.edge_kind, 'memory'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x)
where t.x <> 'memory';

-- `supported_by`: the source material backing a memory. Documents only (ADR 0002 §3).
insert into public.edge_rules (kind, from_type, to_type)
values ('supported_by'::public.edge_kind, 'memory'::public.object_type, 'document'::public.object_type);

-- `derived_from`: what a memory was extracted from. Any object, including another memory (a
-- synthesised insight may be derived from combining two other memories).
insert into public.edge_rules (kind, from_type, to_type)
select 'derived_from'::public.edge_kind, 'memory'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x);

-- `estimates` and `references` were originally seeded as "every object type that existed at the
-- time" (20260921120200_edges.sql), which predates 'memory'. Both are conceptually ANY-typed, so
-- extend them now that 'memory' exists, rather than leaving it as an accidental gap.
insert into public.edge_rules (kind, from_type, to_type)
values ('estimates'::public.edge_kind, 'estimate'::public.object_type, 'memory'::public.object_type)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, f.x, 'memory'::public.object_type
from unnest(enum_range(null::public.object_type)) as f (x)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, 'memory'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x)
on conflict (kind, from_type, to_type) do nothing;

-- `located_at` deliberately does NOT gain a memory row: a memory is not a physically located
-- thing, and its visual context must come from a Project/Sub-project, never from a Location
-- (ADR 0002 §3, approved decision — Locations are shared across projects and must not become a
-- colour authority).
