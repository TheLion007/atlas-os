-- Atlas OS — the Plan vocabulary. See docs/DATABASE.md.
--
-- This file only adds an enum value; nothing here may use it (Postgres forbids using a value
-- added by ALTER TYPE ... ADD VALUE within the same transaction it was added in). The next three
-- migrations, each its own transaction, are where 'plan' is put to use.

-- A programme grouping several standalone projects (e.g. "Plan Nirys" containing several
-- distinct projects). Object type #17, shaped exactly like every other type: a spine row plus
-- one details table for its own fields.
alter type public.object_type add value if not exists 'plan';
