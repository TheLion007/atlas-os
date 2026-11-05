-- Atlas OS — the object spine and the typed detail tables. See docs/DATABASE.md.
--
-- Every object is one row in `objects` plus one row in its `<type>_details` table.
-- Details tables carry only type-specific fields: no derived values (progress, risk level,
-- slip, yield, ...) and no relationship columns (relationships are rows in `edges`).

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  type public.object_type not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status public.lifecycle_status not null default 'active',
  tags text[] not null default '{}' check (cardinality(tags) <= 50),
  -- 0-100; null = never assessed. Bands: high >= 75, medium 45-74, low < 45.
  confidence smallint check (confidence between 0 and 100),
  -- Denormalised body text for search; maintained by the service layer.
  search_text text not null default '',
  search tsvector generated always as (
    to_tsvector('simple'::regconfig, title || ' ' || search_text)
  ) stored,
  owner_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Lets each details table prove its row matches the spine's type and owner.
  constraint objects_id_type_owner_key unique (id, type, owner_id)
);

create index objects_type_status_idx on public.objects (type, status) where deleted_at is null;
create index objects_owner_idx on public.objects (owner_id);
create index objects_tags_idx on public.objects using gin (tags);
create index objects_search_idx on public.objects using gin (search);
create index objects_title_trgm_idx on public.objects using gin (title extensions.gin_trgm_ops);

create trigger objects_set_updated_at
  before update on public.objects
  for each row execute function public.set_updated_at();

create function public.objects_type_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type then
    raise exception 'object type is immutable' using errcode = '23514';
  end if;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'object owner is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger objects_type_immutable
  before update on public.objects
  for each row execute function public.objects_type_immutable();

-- ── project / sub_project ──────────────────────────────────────────────────────────────────
create table public.project_details (
  id uuid primary key,
  type public.object_type not null check (type in ('project', 'sub_project')),
  owner_id uuid not null default auth.uid(),
  description text not null default '' check (char_length(description) <= 10000),
  kind text not null default 'general' check (char_length(btrim(kind)) between 1 and 60),
  -- 1 = highest priority, 4 = lowest.
  priority smallint not null default 2 check (priority between 1 and 4),
  start_date date,
  target_date date,
  -- A target, not an estimate: money with provenance is an Estimate object.
  budget_amount numeric(18, 2) check (budget_amount >= 0),
  budget_currency char(3) check (budget_currency ~ '^[A-Z]{3}$'),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade,
  check (target_date is null or start_date is null or target_date >= start_date),
  check ((budget_amount is null) = (budget_currency is null)),
  -- Sub-projects have no independent budget.
  check (type = 'project' or budget_amount is null)
);

-- ── task ───────────────────────────────────────────────────────────────────────────────────
create table public.task_details (
  id uuid primary key,
  type public.object_type not null default 'task' check (type = 'task'),
  owner_id uuid not null default auth.uid(),
  description text not null default '' check (char_length(description) <= 10000),
  due date,
  -- Roll-up weight; null means the default weight (see src/domain/engine/progress.ts).
  effort numeric check (effort > 0),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── milestone ──────────────────────────────────────────────────────────────────────────────
create table public.milestone_details (
  id uuid primary key,
  type public.object_type not null default 'milestone' check (type = 'milestone'),
  owner_id uuid not null default auth.uid(),
  date date,
  -- Slip is measured against this. Slip itself is derived, never stored.
  baseline_date date,
  gate_criteria jsonb not null default '[]' check (jsonb_typeof(gate_criteria) = 'array'),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── scenario ───────────────────────────────────────────────────────────────────────────────
-- Assumptions and derived dates are not stored: assumptions are estimates with
-- data_kind = 'assumption' and this scenario's id.
create table public.scenario_details (
  id uuid primary key,
  type public.object_type not null default 'scenario' check (type = 'scenario'),
  owner_id uuid not null default auth.uid(),
  variant public.scenario_variant not null,
  description text not null default '' check (char_length(description) <= 2000),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── estimate ───────────────────────────────────────────────────────────────────────────────
create table public.estimate_details (
  id uuid primary key,
  type public.object_type not null default 'estimate' check (type = 'estimate'),
  owner_id uuid not null default auth.uid(),
  amount numeric(18, 4) not null,
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  unit public.estimate_unit not null default 'currency',
  category public.estimate_category not null default 'other',
  data_kind public.data_kind not null default 'estimate',
  source text not null default '' check (char_length(source) <= 300),
  as_of date,
  -- The one qualifier column (ADR 0001 F5): which world this value belongs to. Not a relationship.
  scenario_id uuid references public.scenario_details (id) on delete restrict,
  note text not null default '' check (char_length(note) <= 2000),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade,
  -- Money needs a currency; non-monetary values must not have one.
  check ((unit in ('currency', 'currency_per_month', 'currency_per_year')) = (currency is not null))
);

create index estimate_details_scenario_idx on public.estimate_details (scenario_id);

-- ── location ───────────────────────────────────────────────────────────────────────────────
-- Generic geography: nothing here is specific to any country. Hierarchy is `contains` edges.
create table public.location_details (
  id uuid primary key,
  type public.object_type not null default 'location' check (type = 'location'),
  owner_id uuid not null default auth.uid(),
  level public.location_level not null default 'site',
  country_code char(2) check (country_code ~ '^[A-Z]{2}$'),
  region text,
  city text,
  district text,
  address_line text,
  postal_code text,
  lat numeric(9, 6) check (lat between -90 and 90),
  lng numeric(9, 6) check (lng between -180 and 180),
  -- Provenance of the coordinates: 'manual' or 'geocoder:<name>'. Coordinates are never invented.
  coordinates_source text,
  category text,
  studied_on date,
  verdict text,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade,
  check ((lat is null) = (lng is null))
);

create index location_details_coords_idx on public.location_details (lat, lng)
  where lat is not null;

-- ── property ───────────────────────────────────────────────────────────────────────────────
-- Physical attributes only. Prices, service charges and rents are Estimate objects.
create table public.property_details (
  id uuid primary key,
  type public.object_type not null default 'property' check (type = 'property'),
  owner_id uuid not null default auth.uid(),
  size_m2 numeric check (size_m2 > 0),
  beds smallint check (beds >= 0),
  stage text not null default 'identified' check (char_length(btrim(stage)) between 1 and 60),
  listing_ref text,
  listing_url text,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── decision ───────────────────────────────────────────────────────────────────────────────
create table public.decision_details (
  id uuid primary key,
  type public.object_type not null default 'decision' check (type = 'decision'),
  owner_id uuid not null default auth.uid(),
  question text not null default '' check (char_length(question) <= 1000),
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array'),
  criteria jsonb not null default '[]' check (jsonb_typeof(criteria) = 'array'),
  -- scores[optionId][criterionId]
  scores jsonb not null default '{}' check (jsonb_typeof(scores) = 'object'),
  deadline date,
  resolved_option_id text,
  rationale text not null default '' check (char_length(rationale) <= 5000),
  resolved_at timestamptz,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- No close without a reason: a decision whose object status is 'done' must name a resolved
-- option (one of its options) and carry a rationale. Enforced from both sides so neither
-- writing the details nor flipping the status can bypass it.
create function public.assert_decision_resolved(d public.decision_details, s public.lifecycle_status)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if d.resolved_option_id is not null and not exists (
    select 1 from jsonb_array_elements(d.options) o where o ->> 'id' = d.resolved_option_id
  ) then
    raise exception 'resolved option is not one of the decision options' using errcode = '23514';
  end if;
  if s = 'done' then
    if d.resolved_option_id is null then
      raise exception 'a decision cannot be closed without a resolved option'
        using errcode = '23514';
    end if;
    if btrim(d.rationale) = '' then
      raise exception 'a decision cannot be closed without a rationale' using errcode = '23514';
    end if;
  end if;
end;
$$;

create function public.decision_details_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s public.lifecycle_status;
begin
  select o.status into s from public.objects o where o.id = new.id;
  perform public.assert_decision_resolved(new, s);
  return new;
end;
$$;

create trigger decision_details_check
  before insert or update on public.decision_details
  for each row execute function public.decision_details_check();

create function public.decision_status_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d public.decision_details;
begin
  select * into d from public.decision_details where id = new.id;
  if not found then
    raise exception 'a decision cannot be closed without a resolved option' using errcode = '23514';
  end if;
  perform public.assert_decision_resolved(d, new.status);
  return new;
end;
$$;

create trigger objects_decision_status_check
  before update of status on public.objects
  for each row
  when (new.type = 'decision' and new.status = 'done' and old.status is distinct from new.status)
  execute function public.decision_status_check();

-- ── risk ───────────────────────────────────────────────────────────────────────────────────
-- Level is derived from probability x impact, never stored.
create table public.risk_details (
  id uuid primary key,
  type public.object_type not null default 'risk' check (type = 'risk'),
  owner_id uuid not null default auth.uid(),
  probability smallint not null check (probability between 1 and 5),
  impact smallint not null check (impact between 1 and 5),
  mitigation text not null default '' check (char_length(mitigation) <= 5000),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── note ───────────────────────────────────────────────────────────────────────────────────
-- Backlinks are derived from `references` edges.
create table public.note_details (
  id uuid primary key,
  type public.object_type not null default 'note' check (type = 'note'),
  owner_id uuid not null default auth.uid(),
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array'),
  pinned boolean not null default false,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── document ───────────────────────────────────────────────────────────────────────────────
create table public.document_details (
  id uuid primary key,
  type public.object_type not null default 'document' check (type = 'document'),
  owner_id uuid not null default auth.uid(),
  mime text not null check (char_length(btrim(mime)) between 1 and 120),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  issuer text,
  valid_until date,
  storage_path text,
  checksum text,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── person ─────────────────────────────────────────────────────────────────────────────────
create table public.person_details (
  id uuid primary key,
  type public.object_type not null default 'person' check (type = 'person'),
  owner_id uuid not null default auth.uid(),
  role text,
  org text,
  country_code char(2) check (country_code ~ '^[A-Z]{2}$'),
  last_contact date,
  contact jsonb not null default '{}' check (jsonb_typeof(contact) = 'object'),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- ── event ──────────────────────────────────────────────────────────────────────────────────
create table public.event_details (
  id uuid primary key,
  type public.object_type not null default 'event' check (type = 'event'),
  owner_id uuid not null default auth.uid(),
  starts_at timestamptz not null,
  duration_minutes integer check (duration_minutes >= 0),
  all_day boolean not null default false,
  kind public.event_kind not null default 'appointment',
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);
