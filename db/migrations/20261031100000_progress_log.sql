-- Atlas OS — the work journal: one row per piece of progress (a task finished, a note written, a
-- file added), with its day, its project and its kind. It feeds the Home bars and the Work
-- History grid. Written only by the trigger below. Idempotent: it can be applied to a database
-- that already holds data (the local one) as well as to a fresh one.

create table if not exists public.progress_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  -- The calendar day of the progress, in UTC (the grid draws one square per day).
  day date not null default ((now() at time zone 'utc')::date),
  -- The project it counts for; null when it belongs to none (yet).
  project_id uuid,
  object_id uuid,
  kind text not null check (kind in ('task_done', 'note_created', 'file_added')),
  owner_id uuid not null
);

create index if not exists progress_log_owner_day_idx on public.progress_log (owner_id, day desc);
create index if not exists progress_log_object_idx on public.progress_log (object_id);

alter table public.progress_log enable row level security;
drop policy if exists progress_log_owner_select on public.progress_log;
create policy progress_log_owner_select on public.progress_log
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.progress_log from authenticated;
grant select on public.progress_log to authenticated;

-- The project an object counts for: the first project above it through `contains` edges.
create or replace function public.progress_project_of(obj uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up (id, d) as (
    select obj, 0
    union all
    select e.from_id, up.d + 1
    from public.edges e
    join up on e.to_id = up.id
    where e.kind = 'contains' and e.deleted_at is null and up.d < 8
  )
  select o.id
  from up
  join public.objects o on o.id = up.id
  where o.type = 'project' and o.deleted_at is null
  order by up.d
  limit 1
$$;

-- Notes and documents are usually tied to a project by a `references` edge rather than contained.
create or replace function public.progress_project_for(obj uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.progress_project_of(obj),
    (
      select public.progress_project_of(case when e.from_id = obj then e.to_id else e.from_id end)
      from public.edges e
      where e.kind = 'references'
        and e.deleted_at is null
        and (e.from_id = obj or e.to_id = obj)
        and public.progress_project_of(case when e.from_id = obj then e.to_id else e.from_id end)
          is not null
      limit 1
    )
  )
$$;

create or replace function public.log_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if tg_table_name = 'objects' then
    if tg_op = 'INSERT' and new.type = 'note' then
      k := 'note_created';
    elsif tg_op = 'INSERT' and new.type = 'document' then
      k := 'file_added';
    elsif tg_op = 'UPDATE' and new.type = 'task' and new.status = 'done'
      and old.status is distinct from 'done' then
      k := 'task_done';
    end if;
    if k is not null then
      insert into public.progress_log (kind, object_id, project_id, owner_id)
      values (k, new.id, public.progress_project_for(new.id), new.owner_id);
    end if;
  elsif tg_table_name = 'edges' then
    -- An object is created before it is attached to its project: fill the project in now.
    update public.progress_log p
    set project_id = public.progress_project_for(p.object_id)
    where p.project_id is null and p.object_id in (new.from_id, new.to_id);
  end if;
  return null;
end;
$$;

drop trigger if exists objects_log_progress on public.objects;
create trigger objects_log_progress
  after insert or update on public.objects
  for each row execute function public.log_progress();

drop trigger if exists edges_log_progress on public.edges;
create trigger edges_log_progress
  after insert on public.edges
  for each row execute function public.log_progress();

-- A database that already has work in it starts with a journal that reflects it, dated by when
-- each thing last changed (the best we know). Only when the journal is brand new and empty.
do $$
begin
  if not exists (select 1 from public.progress_log) then
    insert into public.progress_log (at, day, project_id, object_id, kind, owner_id)
    select
      case when o.type = 'task' then o.updated_at else o.created_at end,
      ((case when o.type = 'task' then o.updated_at else o.created_at end) at time zone 'utc')::date,
      public.progress_project_for(o.id),
      o.id,
      case o.type when 'task' then 'task_done' when 'note' then 'note_created' else 'file_added' end,
      o.owner_id
    from public.objects o
    where o.deleted_at is null
      and ((o.type = 'task' and o.status = 'done') or o.type in ('note', 'document'));
  end if;
end;
$$;
