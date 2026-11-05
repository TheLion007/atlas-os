-- Atlas OS — Finance and Documents. See docs/DATABASE.md.
--
-- Everything here extends the existing spine; nothing is a second data model. Derived values
-- (net worth, cash flow, investment return, projections) are still never stored: they come from
-- src/domain/finance.ts.
--
-- Additive and idempotent: only new columns (nullable or with a default, so every existing row
-- stays valid), new tables, new indexes, new edge rules and new policies. Nothing is dropped,
-- renamed, updated or deleted, and every statement can run again without error.

-- ── Estimate: the financial value ──────────────────────────────────────────────────────────
-- Investment fields. `cost_basis` is the invested capital (return = amount − cost_basis, derived);
-- `quantity`/`ticker` describe a holding. `subcategory` is a free, user-chosen spending/holding
-- category ("Housing", "ETF", ...) — deliberately not an enum, so it never has to be migrated.
alter table public.estimate_details
  add column if not exists cost_basis numeric(18, 4),
  add column if not exists quantity numeric(18, 6) check (quantity is null or quantity >= 0),
  add column if not exists ticker text
    check (ticker is null or char_length(btrim(ticker)) between 1 and 20),
  add column if not exists subcategory text
    check (subcategory is null or char_length(btrim(subcategory)) between 1 and 60);

-- An invested capital is money, so it only exists on monetary values (in the same currency).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estimate_cost_basis_is_money'
      and conrelid = 'public.estimate_details'::regclass
  ) then
    alter table public.estimate_details
      add constraint estimate_cost_basis_is_money check (cost_basis is null or currency is not null);
  end if;
end;
$$;

-- ── Transaction: a dated money movement ────────────────────────────────────────────────────
-- Always a fact that happened (never a projection). The account it moved through and what it
-- was for are relations (`references` edges), not columns.
create table if not exists public.transaction_details (
  id uuid primary key,
  type public.object_type not null default 'transaction' check (type = 'transaction'),
  owner_id uuid not null default auth.uid(),
  date date not null,
  -- Always positive: the direction is the kind (income in, expense out, ...).
  amount numeric(18, 4) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  kind public.transaction_kind not null default 'expense',
  subcategory text check (subcategory is null or char_length(btrim(subcategory)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 2000),
  -- Provenance: why Atlas knows this ("manual", "document", "bank_statement", ...).
  source text not null default '' check (char_length(source) <= 300),
  -- Same composite key as every details table: the row can only belong to a transaction object
  -- of the same owner, and goes with it if that object is purged.
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);

create index if not exists transaction_details_date_idx on public.transaction_details (date);
create index if not exists transaction_details_kind_idx on public.transaction_details (kind);

create or replace trigger transaction_details_log_activity
  after update on public.transaction_details
  for each row execute function public.log_activity();

-- ── Document metadata ──────────────────────────────────────────────────────────────────────
-- `content_text` is text extracted from the file, for content search. NULL means "not extracted"
-- (e.g. a PDF before an OCR/extraction step exists) — never an empty pretend value. Existing
-- documents get kind 'other', an empty description and source, and NULL for the rest.
alter table public.document_details
  add column if not exists kind public.document_kind not null default 'other',
  add column if not exists description text not null default ''
    check (char_length(description) <= 2000),
  add column if not exists source text not null default '' check (char_length(source) <= 120),
  add column if not exists original_name text
    check (original_name is null or char_length(original_name) <= 300),
  add column if not exists uploaded_at timestamptz,
  add column if not exists content_text text
    check (content_text is null or char_length(content_text) <= 200000);

-- ── Stored files ───────────────────────────────────────────────────────────────────────────
-- The default file store: bytes in a private, owner-only table, addressed by the document's
-- `storage_path`. It sits behind a FileStore interface (src/server/files), so Supabase Storage
-- (or any object store) can replace it without touching documents or the UI.
create table if not exists public.document_files (
  owner_id uuid not null default auth.uid(),
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  mime text not null check (char_length(btrim(mime)) between 1 and 120),
  size_bytes bigint not null check (size_bytes >= 0),
  checksum text not null,
  bytes bytea not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, storage_path)
);

-- ── Edge rules for transaction ─────────────────────────────────────────────────────────────
-- `references` and `estimates` are ANY-typed; `about`/`derived_from` accept any object from a
-- memory; `located_at` accepts every locatable object. Extend them to the new type, as was done
-- for memory. `on conflict do nothing` keeps these re-runnable.
insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, f.x, 'transaction'::public.object_type
from unnest(enum_range(null::public.object_type)) as f (x)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
select 'references'::public.edge_kind, 'transaction'::public.object_type, t.x
from unnest(enum_range(null::public.object_type)) as t (x)
on conflict (kind, from_type, to_type) do nothing;

insert into public.edge_rules (kind, from_type, to_type)
values
  ('estimates'::public.edge_kind, 'estimate'::public.object_type, 'transaction'::public.object_type),
  ('about'::public.edge_kind, 'memory'::public.object_type, 'transaction'::public.object_type),
  ('derived_from'::public.edge_kind, 'memory'::public.object_type, 'transaction'::public.object_type),
  ('located_at'::public.edge_kind, 'transaction'::public.object_type, 'location'::public.object_type)
on conflict (kind, from_type, to_type) do nothing;

-- ── Security: the same owner-only policy as every other table ──────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['transaction_details', 'document_files']
  loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_owner_all'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated '
        'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
        t || '_owner_all', t
      );
    end if;
  end loop;
end;
$$;
