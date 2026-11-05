/**
 * What the database platform the migrations were written for provides on its own: the `extensions`
 * and `auth` schemas, `auth.uid()`, two roles, and the default grants. The migrations stay pure
 * SQL; a fresh local database (and the SQL tests) get this first.
 */
export const PRELUDE = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, extensions, auth to anon, authenticated;
  -- New public tables are granted to these roles by default; RLS/revokes then narrow that.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;
