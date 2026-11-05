-- Atlas OS — the Memory object. See docs/DATABASE.md and ADR 0002.
--
-- Memory is object type #15, shaped exactly like every other type: a spine row plus one details
-- table for its own fields. Nothing here is a second data model (ADR 0002 §0).
--
-- The statement itself is `objects.title` (<= 200 chars): deliberate, not a limitation — it keeps
-- a memory atomic. Something too long to fit is a Note, not a Memory. Confidence is
-- `objects.confidence` (already generic, already banded by src/domain/confidence.ts) — no new
-- confidence column. Lifecycle is `objects.status`, given memory-specific meaning: draft = not
-- yet reviewed, active = current knowledge, done = a fulfilled goal/plan, dropped = archived.
create table public.memory_details (
  id uuid primary key,
  type public.object_type not null default 'memory' check (type = 'memory'),
  owner_id uuid not null default auth.uid(),
  memory_type public.memory_type not null default 'fact',
  -- A short elaboration beyond the atomic statement in objects.title. Optional on purpose.
  detail text not null default '' check (char_length(detail) <= 1000),
  source_kind public.memory_source_kind not null default 'user',
  pinned boolean not null default false,
  -- Touched by the retrieval engine, not by ordinary reads: powers "recently used" (brief §23).
  -- A memory that has never been retrieved has never been accessed, so it starts null, not now().
  last_accessed_at timestamptz,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

create index memory_details_type_idx on public.memory_details (memory_type);
create index memory_details_last_accessed_idx on public.memory_details (last_accessed_at);

-- No updated_at trigger here: like every other details table, memory_details has none of its own
-- — the spine's updated_at is what the service layer bumps (it always writes both rows together).

create trigger memory_details_log_activity
  after update on public.memory_details
  for each row execute function public.log_activity();
