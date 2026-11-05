-- Atlas OS — settings, FX rates, graph layout and the activity log. See docs/DATABASE.md.

create table public.app_settings (
  owner_id uuid primary key default auth.uid(),
  -- Deliberately no default: the owner chooses their base currency on first run.
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  active_scenario public.scenario_variant not null default 'base',
  timeline_start date,
  timeline_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (timeline_start is null or timeline_end is null or timeline_end > timeline_start)
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Manually maintained. The app never fetches or invents exchange rates, and every rate must
-- state where it came from.
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  from_ccy char(3) not null check (from_ccy ~ '^[A-Z]{3}$'),
  to_ccy char(3) not null check (to_ccy ~ '^[A-Z]{3}$'),
  rate numeric(20, 10) not null check (rate > 0),
  as_of date not null,
  source text not null check (btrim(source) <> ''),
  created_at timestamptz not null default now(),
  check (from_ccy <> to_ccy),
  unique (owner_id, from_ccy, to_ccy, as_of)
);

-- Pinned node positions so the graph stays spatially familiar between visits.
create table public.graph_layout (
  object_id uuid primary key references public.objects (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  x double precision not null,
  y double precision not null,
  pinned boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger graph_layout_set_updated_at
  before update on public.graph_layout
  for each row execute function public.set_updated_at();

-- Written only by the trigger below (users can read it, not edit it).
create table public.activity_log (
  id bigint generated always as identity primary key,
  object_id uuid,
  edge_id uuid,
  action text not null check (
    action in ('created', 'updated', 'deleted', 'restored', 'purged', 'related', 'unrelated')
  ),
  -- For updates: { column: { from, to } }.
  diff jsonb not null default '{}',
  actor uuid default auth.uid(),
  owner_id uuid not null,
  at timestamptz not null default now()
);

create index activity_log_owner_at_idx on public.activity_log (owner_id, at desc);
create index activity_log_object_idx on public.activity_log (object_id, at desc);

create function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb;
  old_rec jsonb;
  changed jsonb;
  act text;
  obj uuid;
  edg uuid;
  is_details boolean := tg_table_name like '%\_details';
begin
  if tg_op = 'DELETE' then
    rec := to_jsonb(old);
  else
    rec := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' then
    old_rec := to_jsonb(old);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('from', old_rec -> k, 'to', v)), '{}')
    into changed
    from jsonb_each(rec) as t (k, v)
    where k not in ('updated_at', 'search') and old_rec -> k is distinct from v;
    if changed = '{}'::jsonb then
      return null;
    end if;
  else
    changed := '{}'::jsonb;
  end if;

  if tg_table_name = 'objects' then
    obj := (rec ->> 'id')::uuid;
    if tg_op = 'INSERT' then
      act := 'created';
    elsif tg_op = 'DELETE' then
      act := 'purged';
    elsif old_rec ->> 'deleted_at' is null and rec ->> 'deleted_at' is not null then
      act := 'deleted';
    elsif old_rec ->> 'deleted_at' is not null and rec ->> 'deleted_at' is null then
      act := 'restored';
    else
      act := 'updated';
    end if;
  elsif tg_table_name = 'edges' then
    obj := (rec ->> 'from_id')::uuid;
    edg := (rec ->> 'id')::uuid;
    if tg_op = 'INSERT' then
      act := 'related';
      changed := jsonb_build_object('kind', rec -> 'kind', 'to', rec -> 'to_id');
    elsif tg_op = 'DELETE' then
      act := 'unrelated';
    elsif old_rec ->> 'deleted_at' is null and rec ->> 'deleted_at' is not null then
      act := 'unrelated';
    else
      act := 'updated';
    end if;
  elsif is_details then
    -- Creation is already logged by the spine row; only field changes are interesting here.
    if tg_op <> 'UPDATE' then
      return null;
    end if;
    obj := (rec ->> 'id')::uuid;
    act := 'updated';
  else
    return null;
  end if;

  insert into public.activity_log (object_id, edge_id, action, diff, owner_id)
  values (obj, edg, act, changed, (rec ->> 'owner_id')::uuid);
  return null;
end;
$$;

create trigger objects_log_activity
  after insert or update or delete on public.objects
  for each row execute function public.log_activity();

create trigger edges_log_activity
  after insert or update or delete on public.edges
  for each row execute function public.log_activity();

create trigger project_details_log_activity after update on public.project_details for each row execute function public.log_activity();
create trigger task_details_log_activity after update on public.task_details for each row execute function public.log_activity();
create trigger milestone_details_log_activity after update on public.milestone_details for each row execute function public.log_activity();
create trigger scenario_details_log_activity after update on public.scenario_details for each row execute function public.log_activity();
create trigger estimate_details_log_activity after update on public.estimate_details for each row execute function public.log_activity();
create trigger location_details_log_activity after update on public.location_details for each row execute function public.log_activity();
create trigger property_details_log_activity after update on public.property_details for each row execute function public.log_activity();
create trigger decision_details_log_activity after update on public.decision_details for each row execute function public.log_activity();
create trigger risk_details_log_activity after update on public.risk_details for each row execute function public.log_activity();
create trigger note_details_log_activity after update on public.note_details for each row execute function public.log_activity();
create trigger document_details_log_activity after update on public.document_details for each row execute function public.log_activity();
create trigger person_details_log_activity after update on public.person_details for each row execute function public.log_activity();
create trigger event_details_log_activity after update on public.event_details for each row execute function public.log_activity();
