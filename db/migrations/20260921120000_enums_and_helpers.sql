-- Atlas OS — vocabularies and helpers. See docs/DATABASE.md.
-- Mirrors src/domain/enums.ts; a test asserts the two stay in sync.

create extension if not exists pg_trgm with schema extensions;

create type public.object_type as enum (
  'project', 'sub_project', 'task', 'milestone', 'estimate', 'scenario', 'location',
  'property', 'decision', 'risk', 'note', 'document', 'person', 'event'
);

-- Lifecycle only. "Blocked" is derived from depends_on edges and is never stored.
create type public.lifecycle_status as enum ('draft', 'active', 'done', 'dropped');

create type public.edge_kind as enum (
  'contains', 'depends_on', 'estimates', 'funded_by', 'located_at', 'references'
);

-- Provenance of a financial value, orthogonal to lifecycle status.
create type public.data_kind as enum ('actual', 'target', 'estimate', 'scenario', 'assumption');

create type public.scenario_variant as enum ('conservative', 'base', 'optimistic');
create type public.dependency_type as enum ('fs', 'ss', 'ff', 'sf');

create type public.estimate_category as enum (
  'capital', 'income', 'expense', 'investment', 'acquisition_cost', 'property_cost',
  'rental', 'projection', 'other'
);

create type public.estimate_unit as enum (
  'currency', 'currency_per_month', 'currency_per_year', 'percent', 'area_m2', 'count'
);

create type public.location_level as enum (
  'planet', 'country', 'region', 'city', 'district', 'neighbourhood', 'address', 'site'
);

create type public.event_kind as enum ('trip', 'appointment', 'deadline');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
