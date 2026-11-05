# Atlas OS — Development

## Prerequisites

| Tool    | Version                | Notes                            |
| ------- | ---------------------- | -------------------------------- |
| Node.js | ≥ 22 (developed on 24) |                                  |
| npm     | ≥ 10                   | Lockfile is `package-lock.json`. |
| Git     | any recent             |                                  |

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in values
npm run dev                    # http://localhost:3000
```

> **Use `npm run dev`, not `npm run build && npm start`, for local development.** `next start`
> always forces `NODE_ENV=production` — Next.js does this itself, unconditionally — which means
> both dev-only switches below (`NEXT_PUBLIC_ATLAS_FIXTURES`, `ATLAS_DEV_OWNER_ID`) are correctly
> and silently ignored under it, and `/login` shows the "sign-in is not connected" screen exactly
> as it does in real production. That is the deny-by-default design working as intended, not a
> bug — but it looks identical to a misconfigured `.env.local` from the outside. If localhost is
> stuck at the login screen, check which command started the server before changing anything.

## Scripts

| Script                            | Purpose                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                     | Next.js dev server                                                          |
| `npm run build` / `npm start`     | Production build / serve                                                    |
| `npm run lint`                    | ESLint                                                                      |
| `npm run typecheck`               | `tsc --noEmit` (strict)                                                     |
| `npm test`                        | Vitest, single run                                                          |
| `npm run test:watch`              | Vitest watch                                                                |
| `npm run format` / `format:check` | Prettier                                                                    |
| `npm run check`                   | lint + typecheck + test + format check (CI runs this, then `npm run build`) |

## Environment variables

Documented in [`.env.example`](../.env.example). **Never commit `.env*` files** (only `.env.example`). Keys are never hard-coded.

| Variable                     | Scope                 | Purpose                                                                                                       |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ATLAS_DB_DIR`               | server only, optional | Folder of the local database (default `data/atlas-pgdata`).                                                   |
| `ATLAS_BACKUP_DIR`           | scripts, optional     | Where `npm run db:backup` writes copies (default `D:/backups/atlas`).                                         |
| `NEXT_PUBLIC_ATLAS_FIXTURES` | dev only              | `1` runs the whole app on illustrative fixtures with no database (demo mode). **Never active in production.** |
| `ANTHROPIC_API_KEY`          | server only, optional | Enables LLM synthesis in the assistant (Phase 9). Absent ⇒ deterministic answers only.                        |

## Exploring the UI without a database

```bash
echo NEXT_PUBLIC_ATLAS_FIXTURES=1 > .env.local   # git-ignored
npm run dev                                       # http://localhost:3000
```

Demo mode serves the illustrative dataset (Borland and Dorsel; every figure invented and tagged `illustrative`). `/design` shows every token and component state (development only). To check the UI in a real browser at desktop, tablet and mobile widths (screenshots, axe with contrast, overflow and console checks) with the dev server running:

```bash
BASE_URL=http://localhost:3000 OUT_DIR=screenshots node scripts/verify-ui.mjs
```

## Local database

The data lives in an embedded Postgres (PGlite) in `data/atlas-pgdata/`, opened by the app itself — no Docker, no external service. The schema is `db/migrations/`. See the [README](../README.md) for backup, restore and moving to another PC.

## Tests

`npm test` runs everything, with no Docker and no network:

| Where                                    | What                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/**/*.test.ts`                       | Pure domain code (schemas, edge rules, engine) and small units, next to the code they test.                                                          |
| `tests/sql/`                             | Every migration applied to an in-process Postgres (PGlite): constraints, triggers, RLS, activity log, enum and edge-rule parity with the TS domain.  |
| `tests/api/`                             | The real route handlers called with real `Request` objects against the migrated database: auth, isolation, CRUD, relations, validation, HTTP status. |
| `tests/support/`, `tests/sql/helpers.ts` | Harnesses. They recreate only what Supabase provides (roles, `auth.uid()`); migrations themselves stay pure Supabase SQL.                            |

When you change a migration, a test should fail if the rule it enforces stops working. Prove it: temporarily break the rule and confirm the suite goes red.

## Conventions

- **TypeScript strict**; no `any` without a comment explaining why.
- **Domain code is pure** (`src/domain`): no I/O, no React, no DB, no `Date.now()` — inject "today".
- **Never store a derived value.** If it can be computed by the engine, compute it.
- **Relationships are edges.** Don't add a foreign-key column for a relationship (one documented exception: `estimate_details.scenario_id`).
- **No hard-coded places, currencies or seed data in components.** Data comes from the store; fixtures live in `src/seed`.
- **Every new dependency needs a reason** recorded in the PR/commit message and, if architectural, in `ARCHITECTURE.md`.
- **Tokens, not literals.** Colours, spacing, radii, durations come from the design tokens.
- Components ship with their states and tests.

## Git

- Branch: `main`. Small, logical commits at the end of each meaningful milestone; no history rewriting.
- Commit messages: imperative summary line; body explains _why_.
- **Nothing is pushed until explicitly requested.** The GitHub remote is added with `git remote add origin <url>` when the owner provides it.
- Never commit: `.env*`, credentials, tokens, private keys, local databases, build artifacts.

## Definition of done (per phase)

1. Implementation matches the blueprint sections it claims to satisfy.
2. `npm run check` passes.
3. Tests cover new logic (engine, SQL constraints, API, component states).
4. `docs/` updated in the same commit (PRODUCT / ARCHITECTURE / DATABASE / DESIGN-SYSTEM / DEVELOPMENT as relevant; phase status in ARCHITECTURE.md).
5. Committed.

## Phase status

See the table in [`ARCHITECTURE.md`](./ARCHITECTURE.md#phases).
