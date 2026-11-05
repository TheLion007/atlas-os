-- Atlas OS — context colour and the tag catalogue. See docs/DATABASE.md and ADR 0002.
--
-- Colour: a small, spine-level, generic column. It stores a design-system *token key*
-- (validated by format only — the exact palette lives in src/design/tokens.ts and is a design
-- decision, not a schema one), never a raw hex value. At launch only project/sub_project may
-- carry one (ADR 0002 §5); the CHECK below is the deliberate, easily-relaxed enforcement of that.
alter table public.objects
  add column color text check (color ~ '^[a-z][a-z0-9_]{0,31}$'),
  add constraint objects_color_type_check
    check (color is null or type in ('project', 'sub_project'));

-- Tags: a first-class catalogue layered under the existing `objects.tags text[]`, which stays
-- exactly as it is (including its role feeding `search_text`) but becomes a denormalised cache of
-- `object_tags`, the same relationship `search_text`/`search` already have to their source rows.
-- System tags (#project, #task, ...) are a presentational alias over `object.type` and are never
-- rows here — `kind` is reserved for a possible future built-in tag, not used at launch.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  kind text not null default 'user' check (kind in ('system', 'user')),
  -- A token key into the design system's colour palette (see the `color` column above), or null.
  color text check (color ~ '^[a-z][a-z0-9_]{0,31}$'),
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness needs an expression index: a plain UNIQUE table constraint cannot
-- take lower(name), only column names.
create unique index tags_owner_name_unique_idx on public.tags (owner_id, lower(name));
create index tags_owner_idx on public.tags (owner_id);

create table public.object_tags (
  object_id uuid not null references public.objects (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (object_id, tag_id)
);

create index object_tags_tag_idx on public.object_tags (tag_id);
create index object_tags_owner_idx on public.object_tags (owner_id);

-- A tag and the object it is attached to must be owned by the same person, exactly like an edge's
-- endpoints must be (see validate_edge() in 20260921120200_edges.sql).
create function public.validate_object_tag()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  obj_owner uuid;
  tag_owner uuid;
begin
  select owner_id into obj_owner from public.objects where id = new.object_id;
  select owner_id into tag_owner from public.tags where id = new.tag_id;
  if obj_owner is null or tag_owner is null then
    raise exception 'tag or object does not exist' using errcode = '23503';
  end if;
  if obj_owner <> new.owner_id or tag_owner <> new.owner_id then
    raise exception 'a tag cannot be attached to another owner''s object' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger object_tags_validate
  before insert or update on public.object_tags
  for each row execute function public.validate_object_tag();
