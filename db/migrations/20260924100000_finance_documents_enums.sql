-- Atlas OS — Finance and Documents vocabularies. See docs/DATABASE.md.
--
-- This file only adds enum values and types; nothing here may use them (Postgres forbids using a
-- value added by ALTER TYPE ... ADD VALUE within the same transaction). The next migration, its
-- own transaction, is where they are put to use.
--
-- Additive and idempotent: every statement can run again without error and without touching
-- existing rows (enum values are only ever added, never renamed or removed).

-- Balance-sheet categories for the Estimate object, which stays THE financial value of Atlas:
-- one value = one object, with its data kind (actual/target/estimate/scenario/assumption),
-- currency, source and date. `capital` keeps its meaning (money available to deploy).
alter type public.estimate_category add value if not exists 'cash';
alter type public.estimate_category add value if not exists 'asset';
alter type public.estimate_category add value if not exists 'liability';

-- What a dated money movement was. Transactions are always actual: a projection is an Estimate.
do $$
begin
  create type public.transaction_kind as enum (
    'income', 'expense', 'transfer', 'investment', 'withdrawal'
  );
exception
  when duplicate_object then null;
end;
$$;

-- What a document is for (its format is derived from the mime type, never stored twice).
do $$
begin
  create type public.document_kind as enum (
    'other', 'receipt', 'invoice', 'contract', 'statement', 'tax', 'identity', 'administrative',
    'report'
  );
exception
  when duplicate_object then null;
end;
$$;

-- A dated money movement is its own object on the spine, so it can be searched, related and
-- shown in the graph like everything else.
alter type public.object_type add value if not exists 'transaction';
