-- Atlas OS — Memory vocabularies. See docs/DATABASE.md and ADR 0002.
--
-- This file only adds enum values; nothing here may use them (Postgres forbids using a value
-- added by ALTER TYPE ... ADD VALUE within the same transaction it was added in). The next three
-- migrations, each its own transaction, are where 'memory' and the new edge kinds are put to use.

create type public.memory_type as enum (
  'fact', 'preference', 'goal', 'plan', 'constraint', 'insight'
);

-- How a memory entered Atlas. Not itself the answer to "why does Atlas remember this" — that is
-- the derived_from/about edges and the object's own created_at (ADR 0002 §9). This only records
-- who/what created the row.
create type public.memory_source_kind as enum ('user', 'ai_proposal', 'import');

alter type public.object_type add value 'memory';

-- Typed edges for the Memory graph (ADR 0002 §3). `about`/`supported_by`/`derived_from` are not
-- hierarchical: no cycle check and no single-parent constraint applies to them (see
-- validate_edge() in 20260921120200_edges.sql, which only special-cases contains/depends_on).
alter type public.edge_kind add value 'about';
alter type public.edge_kind add value 'supported_by';
alter type public.edge_kind add value 'derived_from';
