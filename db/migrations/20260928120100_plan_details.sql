-- Atlas OS — the Plan object. See docs/DATABASE.md.
--
-- Plan is shaped exactly like every other type: a spine row plus one details table for its own
-- fields. A plan's own progress is never stored — it is a presentation-only rollup of its member
-- projects' already-computed progress (src/domain/command-center.ts), the same way every other
-- derived value in Atlas is computed, not stored.
create table public.plan_details (
  id uuid primary key,
  type public.object_type not null default 'plan' check (type = 'plan'),
  owner_id uuid not null default auth.uid(),
  description text not null default '' check (char_length(description) <= 10000),
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

-- No updated_at trigger here: like every other details table, plan_details has none of its own
-- — the spine's updated_at is what the service layer bumps (it always writes both rows together).

create trigger plan_details_log_activity
  after update on public.plan_details
  for each row execute function public.log_activity();
