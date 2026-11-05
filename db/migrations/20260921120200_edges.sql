-- Atlas OS — typed edges. Edges are the single source of truth for relationships.
-- See docs/DATABASE.md. The rule table mirrors src/domain/edge-rules.ts; a test asserts parity.

-- Which (kind, from_type, to_type) combinations are legal.
create table public.edge_rules (
  kind public.edge_kind not null,
  from_type public.object_type not null,
  to_type public.object_type not null,
  primary key (kind, from_type, to_type)
);

insert into public.edge_rules (kind, from_type, to_type)
select 'contains'::public.edge_kind, f.x, t.x
from unnest(array['project', 'sub_project']::public.object_type[]) as f (x),
     unnest(array['sub_project', 'task', 'milestone', 'risk', 'decision', 'property', 'event']::public.object_type[]) as t (x);

insert into public.edge_rules (kind, from_type, to_type) values ('contains', 'location', 'location');

insert into public.edge_rules (kind, from_type, to_type)
select 'depends_on'::public.edge_kind, f.x, t.x
from unnest(array['project', 'sub_project', 'task', 'milestone', 'decision', 'estimate']::public.object_type[]) as f (x),
     unnest(array['project', 'sub_project', 'task', 'milestone', 'decision', 'estimate']::public.object_type[]) as t (x);

insert into public.edge_rules (kind, from_type, to_type)
select 'estimates'::public.edge_kind, 'estimate'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x);

insert into public.edge_rules (kind, from_type, to_type)
select 'funded_by'::public.edge_kind, f.x, 'estimate'::public.object_type
from unnest(array['project', 'sub_project', 'property', 'estimate']::public.object_type[]) as f (x);

insert into public.edge_rules (kind, from_type, to_type)
select 'located_at'::public.edge_kind, f.x, 'location'::public.object_type
from unnest(enum_range(null::public.object_type)) as f (x)
where f.x <> 'location';

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, f.x, t.x
from unnest(enum_range(null::public.object_type)) as f (x),
     unnest(enum_range(null::public.object_type)) as t (x);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  kind public.edge_kind not null,
  from_id uuid not null references public.objects (id) on delete cascade,
  to_id uuid not null references public.objects (id) on delete cascade,
  -- Free label, e.g. 'assignee' or 'owner' on references edges.
  label text check (char_length(label) <= 60),
  -- depends_on only: the Dependency payload.
  dependency_type public.dependency_type,
  lag_days integer check (lag_days between -3650 and 3650),
  owner_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (from_id <> to_id),
  check (
    (kind = 'depends_on' and dependency_type is not null and lag_days is not null)
    or (kind <> 'depends_on' and dependency_type is null and lag_days is null)
  )
);

-- At most one live edge of a kind between two objects.
create unique index edges_live_unique_idx on public.edges (kind, from_id, to_id)
  where deleted_at is null;
-- Single parent: the containment graph is a forest, so progress roll-up is a tree.
create unique index edges_single_parent_idx on public.edges (to_id)
  where kind = 'contains' and deleted_at is null;
create index edges_from_idx on public.edges (from_id, kind) where deleted_at is null;
create index edges_to_idx on public.edges (to_id, kind) where deleted_at is null;
create index edges_owner_idx on public.edges (owner_id);

create trigger edges_set_updated_at
  before update on public.edges
  for each row execute function public.set_updated_at();

create function public.validate_edge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f record;
  t record;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  select o.type, o.owner_id, o.deleted_at into f from public.objects o where o.id = new.from_id;
  select o.type, o.owner_id, o.deleted_at into t from public.objects o where o.id = new.to_id;

  if f.type is null or t.type is null then
    raise exception 'edge endpoint does not exist' using errcode = '23503';
  end if;
  if f.deleted_at is not null or t.deleted_at is not null then
    raise exception 'cannot relate a deleted object' using errcode = '23514';
  end if;
  if f.owner_id <> new.owner_id or t.owner_id <> new.owner_id then
    raise exception 'edges cannot cross owners' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.edge_rules r
    where r.kind = new.kind and r.from_type = f.type and r.to_type = t.type
  ) then
    raise exception 'a % cannot % a %', f.type, new.kind, t.type using errcode = '23514';
  end if;

  if new.kind in ('contains', 'depends_on') then
    -- Serialise writers of an acyclic kind so two concurrent inserts cannot jointly close a cycle.
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text || ':' || new.kind::text, 0));

    -- Adding from -> to closes a cycle iff `from` is already reachable from `to`.
    if exists (
      with recursive walk (id) as (
        select new.to_id
        union
        select e.to_id
        from public.edges e
        join walk w on e.from_id = w.id
        where e.kind = new.kind and e.deleted_at is null and e.id <> new.id
      )
      select 1 from walk where id = new.from_id
    ) then
      raise exception 'this % relation would create a cycle', new.kind using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger edges_validate
  before insert or update of kind, from_id, to_id, deleted_at on public.edges
  for each row execute function public.validate_edge();

-- Soft-deleting an object soft-deletes its live edges. Restoring an object does not resurrect
-- them: each edge must be re-validated and re-created deliberately.
create function public.cascade_object_soft_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.edges
  set deleted_at = new.deleted_at
  where deleted_at is null and (from_id = new.id or to_id = new.id);
  return new;
end;
$$;

create trigger objects_cascade_soft_delete
  after update of deleted_at on public.objects
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.cascade_object_soft_delete();
