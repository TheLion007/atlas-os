# Atlas OS — Architecture

Decisions and their rationale: [`decisions/0001-accepted-architecture.md`](./decisions/0001-accepted-architecture.md), [`decisions/0002-memory-knowledge-architecture.md`](./decisions/0002-memory-knowledge-architecture.md). Schema: [`DATABASE.md`](./DATABASE.md).

## Principles

1. **One dataset, four lenses.** Command Center, Map, Graph and Timeline are projections of the same object/edge store. No lens owns data.
2. **Edges are the source of truth** for relationships. Arrays/refs on objects are derived views.
3. **Derived values are never stored.** They come from the pure domain engine.
4. **Generic by construction.** No place, currency or project type is hard-coded into logic.
5. **Every dependency earns its place.**
6. **Memory is a lens, not a second database.** Durable knowledge is object type `memory` on the same spine, related through the same `edges` table, secured by the same RLS, and searched by the same index — never a parallel graph, store or AI-only structure (ADR 0002).
7. **AI is a consumer of structure, not the owner of it.** Explicit relationships, tags and confidence are authoritative; retrieval ranks by them first and treats similarity as an optional, last tier that degrades to nothing without an LLM (ADR 0002 §7).

## Stack

| Concern       | Choice                                                                               | Why                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App framework | Next.js (App Router), React, TypeScript (strict)                                     | Routing, route handlers for the blueprint's REST shape, Vercel-native.                                                                                                                                                                        |
| Database      | PostgreSQL embedded locally (**PGlite**), one folder on disk                         | Real FKs, constraints, recursive CTEs, RLS, Auth, Storage in one place.                                                                                                                                                                       |
| Data access   | Parameterised SQL behind a small `Db` interface (`postgres` driver; PGlite in tests) | Schema, constraints, triggers and RLS live in SQL migrations; a second TypeScript copy of 20 tables (an ORM schema) would only drift. Results are validated by Zod at the boundary. Recursive graph queries stay plain SQL. See ADR 0001 R14. |
| Validation    | Zod                                                                                  | One schema set shared by API, forms, import/export.                                                                                                                                                                                           |
| Server state  | TanStack Query                                                                       | Cache, optimistic updates, persisted read cache (local-first spirit).                                                                                                                                                                         |
| UI state      | URL params + a small Zustand store                                                   | Lens switches must preserve selection/filters, so URL is the source of truth for shareable state.                                                                                                                                             |
| Styling       | Tailwind CSS v4 + project design tokens                                              | Tokens come from the blueprint; **no** stock shadcn theme.                                                                                                                                                                                    |
| Primitives    | Radix UI (unstyled)                                                                  | Accessible dialogs, menus, popovers, command palette. Styled entirely by Atlas tokens.                                                                                                                                                        |
| Graph         | `d3-force` + Canvas2D `GraphCanvas`                                                  | Blueprint needs settling physics, drag-to-pin, two-hop dimming, path mode. React Flow is a node editor, not a force simulation.                                                                                                               |
| Map           | MapLibre GL JS (globe projection), custom dark style, open vector tiles              | Real geography with no API key or per-load cost. Provider is behind an interface so Mapbox can be swapped in.                                                                                                                                 |
| Timeline      | Custom SVG/DOM `GanttBoard` over the schedule engine                                 | Dependency hairlines, slip ghosts and scenario redraw are engine-driven; no off-the-shelf Gantt fits.                                                                                                                                         |
| Auth          | None: single local owner, app bound to 127.0.0.1                                     | Private by default.                                                                                                                                                                                                                           |
| Tests         | Vitest (+ PGlite for SQL), Playwright (flows F1–F5), axe                             | Engine correctness, schema correctness, real flows, accessibility.                                                                                                                                                                            |
| Hosting       | Local only (nothing exposed to the internet)                                         |                                                                                                                                                                                                                                               |

Dependencies are added in the phase that first uses them.

## Layers

```
src/
  app/          Routes: shell layout, lenses, collections, and api/ route handlers
  domain/       PURE TypeScript — no I/O, no React, no DB. Importable on client and server.
    enums.ts · dates.ts · confidence.ts   Closed vocabularies, UTC date maths, confidence bands
    schemas.ts                            Zod schemas: create object (per type) and create edge
    edge-rules.ts · graph-validation.ts   Allowed (kind, from, to) matrix; cycle / single-parent checks
    context-color.ts · memory.ts          Memory's derived display colour and provenance (ADR 0002 §5, §9)
    memory-model.ts                       Memory Storage's view-model: rows, filters, sort, grouping, the Memory Graph's bounded subgraph — all derived, nothing stored twice
    memory-health.ts                      Deterministic health flags (duplicate/low-confidence/stale/orphaned/possible-contradiction) — a prompt to review, never a decision Atlas makes
    retrieval.ts                          Budgeted, ranked, cited context for the future assistant — structure first, semantics last, zero AI dependency by default (ADR 0002 §7)
    finance.ts                            Finance, derived: roles, net worth, cash flow, goals, allocation, monthly flows, projections per scenario — actual never mixed with target/estimate/assumption; FX only from the owner's rates
    documents.ts · linking.ts             Document library view-model (format, preview kind, rows, content-aware search) · the one rule choosing the edge when two objects are linked
    engine/       progress · risk · blocked · schedule/slip (planned: critical-path · capital · yield · simulate)
  server/       db/ (Db interface, postgres driver, asOwner) · objects/ (service, edges, mapping, tags, search) · auth · context · http · errors
                (planned: timeline, simulate, io services)
  components/   ui/ (atoms/molecules) · shell/ · canvases (graph/, map/, timeline/) · feature widgets
  lib/          Formatting (tabular numerals, currency), constants, small utilities
  seed/         Typed, coherent seed builder (illustrative data)
db/             migrations/ (SQL source of truth)
tests/          e2e (Playwright)
docs/
```

Dependency direction: `app → components → domain`, `app → server → domain`. `domain` imports nothing from the rest of the app.

## Client data flow

One interface, two implementations: `AtlasDataSource` (`src/client/data-source.ts`) is implemented by the HTTP API and by a **development-only** in-memory fixture source over the illustrative seed. Components and hooks depend only on the interface, so there is no second data model. The fixture source is imported dynamically behind a `NODE_ENV` check and can never be enabled in production (tested). The lenses fetch the whole dataset once (`/api/graph?details=true`) and compute derived values with the pure engine on the client: progress, blocked, schedule and slip, risk level, capital in the base currency via manual FX. Nothing derived is fetched or stored.

The auth boundary is `getSession()` (`src/server/session.ts`): the shell layout redirects to `/login` when there is no session. The Supabase session resolver plugs in behind `authenticate` without touching any page.

## Domain engine (the heart)

A single pure module consumed by Timeline, Graph path mode, Command Center, Finance and the assistant. Because it is pure, it can run on the server _and_ client (local-first spirit; instant scenario preview).

| Function            | Derives                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `rollUpProgress`    | Project/sub-project progress by weighted task effort along `CONTAINS`. "No data" when no effort.                                    |
| `riskLevel`         | Probability × impact bucket.                                                                                                        |
| `computeSchedule`   | Scheduled dates per milestone/task from `DEPENDS_ON` edges (with lag, dependency kind) under a scenario; slip vs `baseline_date`.   |
| `criticalPath`      | Longest dependency chain to a target.                                                                                               |
| `computeBlocked`    | Objects whose hard predecessors are unfinished or slipped.                                                                          |
| `capitalProjection` | Monthly capital curve per scenario from assumptions. Deterministic.                                                                 |
| `purchaseDate`      | First month projected capital covers required equity.                                                                               |
| `yield`             | From rent/price/service-charge estimates for the active scenario.                                                                   |
| `simulate`          | Diff between committed state and a candidate scenario/assumption change: "3 milestones move, 1 decision reopens". **Never writes.** |

## API surface

Blueprint REST shape, implemented as Next.js route handlers (all authenticated, all Zod-validated):

```
GET   /api/objects?type=&status=          list/filter
GET   /api/objects/:id?expand=relations   object + edges grouped by verb
POST  /api/objects                        create (object + typed details + edges, transactional)
PATCH /api/objects/:id                    partial update, re-validated as a whole; type cannot change
DELETE /api/objects/:id                   soft delete (relations soft-deleted with it)
POST  /api/edges                          relate two objects (DB enforces type matrix, cycles, single parent)
DELETE /api/edges/:id                     soft-delete a relation
GET   /api/graph?details=true             every live object (+ details) and relation (from/depth: Graph phase)
GET   /api/timeline?scenario=base         scheduled items + dependency edges
POST  /api/scenarios/:id/simulate         preview only; returns the diff
GET   /api/search?q=                      unified search across every type incl. Memory, server-side, tsvector + trigram + #tag (ADR 0002 §6); accent-insensitive ("precompte" finds "précompte"), incl. extracted document text
POST  /api/files                          store one file (multipart); the client then creates the document object with its metadata
GET   /api/files/:storagePath             the owner's file, served safely (only PDF, raster images and plain text inline; the rest as a download)
DELETE /api/files/:storagePath            remove a stored file (cleanup after a failed import)
GET   /api/tags   POST /api/tags          the user tag catalogue
PATCH /api/tags/:id   DELETE /api/tags/:id
POST  /api/objects/:id/tags               attach a tag ({ tagId })
DELETE /api/objects/:id/tags/:tagId       detach a tag
POST  /api/assistant/query                grounded answer with object citations (not yet wired to an LLM; the retrieval
                                           foundation it will call — src/domain/retrieval.ts — is built, see ADR 0002 §7)
GET   /api/export   POST /api/import      portable JSON (see DATABASE.md)
GET   /api/settings                       base currency (null until chosen), scenario, manual FX rates
GET   /api/activity?limit=                what changed recently (survives object purge)
GET   /api/health                         liveness
```

## Data access & security

- Route handlers verify the Supabase session, then query Postgres through a server-only connection with explicit `owner_id` scoping.
- **RLS is enabled on every table** with owner-only policies and deny-by-default for `anon`, so the auto-generated Supabase REST surface exposes nothing even if its keys leak.
- Public sign-up is disabled in Supabase Auth config (single user).
- No secrets in the repo. All keys via environment variables; `.env.example` documents them. `.env*` is git-ignored.
- Soft-delete (`deleted_at`) on objects and edges; hard purge is an explicit action.
- Uploaded documents live in a private, owner-only file store behind `FileStore` (`src/server/files/store.ts`); the default keeps bytes in `document_files`, and Supabase Storage (signed URLs) can replace it without touching the rest.

## Graph design notes

- Nodes = objects; edges = typed edges. Node size = weight in the plan (derived); colour = type.
- `d3-force` simulation runs to a settled state, then **stops** (no perpetual animation). Dragging pins a node; pinned positions persist per user so spatial familiarity develops.
- Two-hop focus dimming on select; type legend doubles as a filter; path mode highlights the cause → effect chain from the engine.
- Rendering on Canvas2D; hit-testing via quadtree. Target: smooth at thousands of nodes.
- Mobile: radial ego-view (selected node + neighbours), not a shrunken desktop canvas.

## Map design notes

- MapLibre GL, globe projection, dark minimal style, restrained zoom-gated labels.
- Navigation ladder follows `Location` hierarchy (`CONTAINS` edges): Earth → country → region → city → district → project.
- Anything with a `LOCATED_AT` edge to a Location with coordinates appears as a typed pin. Locations without coordinates show as "unplaced" — never faked.
- Geocoding is behind an interface, records provenance, and never invents coordinates. Boundaries come only from real open data.
- Mobile: list-first, map secondary.

## Memory design notes (ADR 0002)

- Memory is object type `memory` on the ordinary spine — not a second graph, database or renderer. Its statement is the shared `title` (≤200 chars: deliberate, keeps a memory atomic); confidence, status, tags and soft-delete are the same spine fields every other type already has.
- Provenance ("why does Atlas remember this") is never a free-text field: it is `source_kind` plus the `derived_from`/`about`/`supported_by` edges, read by `src/domain/memory.ts`'s `memoryProvenance()`.
- Display colour is never stored on a memory: `src/domain/context-color.ts`'s `resolveMemoryContext()` derives it from the primary `about`-linked Project/Sub-project (the `about` edge labelled `"primary"`, or the oldest one). Locations are deliberately excluded as a colour authority — they are shared across projects.
- **Memory Storage** (`/memory`, `src/components/lenses/MemoryLens.tsx`) is the Memory Core: search, project/type/confidence/status filters (composable), sort (updated/created/alphabetical/confidence/relevance), and three views — List, Grid, Graph — over the same `MemoryRow`s (`src/domain/memory-model.ts`). Nothing here is a second store: `buildMemoryRows()` derives every row from the shared `useGraph()` payload, the same one every other lens reads.
- The **Memory Graph** tab reuses `GraphCanvas` exactly as-is (no fork, no new rendering engine): `memoryGraphSubset()` bounds the node/edge set to every memory plus its one-hop `about`/`supported_by`/`derived_from`/`references` neighbours. Memory's own "knowledge" colour family (from the object-type palette) is what distinguishes memory nodes today; per-node context-colouring inside the graph canvas was deliberately not built this pass (see ADR 0002's implementation notes) to avoid touching `graph-engine.ts`'s shared colouring model. The main `/graph`'s own type-legend filter can already show memory nodes too, with zero code change.
- **Project context is inspectable and editable from the object page/peek panel**: a memory's Context section shows its primary (colour-bearing) and secondary project chips, plus an "Add project context" control (`useCreateEdge`) that attaches a further `about` edge — this is the one place in the app that creates an edge between two already-existing objects outside the creation dialog. Provenance is its own section: `source_kind` plus any `derived_from`/`supported_by` chips.
- **Health flags** (`src/domain/memory-health.ts`): duplicate, low confidence, stale, orphaned and a structural "possible contradiction" heuristic (same project, same type, a shared tag) are surfaced as clickable filters in the Storage view — never auto-resolved. `unused` (via `last_accessed_at`) stays in the type union but is not computed yet: nothing writes that column until retrieval has a real consumer, so firing it today would flag every memory as noise, not signal.
- Retrieval (`src/domain/retrieval.ts`) is the **only** path anything — including a future LLM — reads Memory's context through. It is pure, deterministic, structure-first (explicit focus → direct relation → project relation → location relation → shared tags → type match → text match → recency → confidence → semantic, which contributes nothing without an embeddings phase) and budget-capped (`maxItems`, `maxTokens`, `maxRelationDepth`).
- **What is still not built**: the AI-proposal card and any LLM connection (a separate, future approval — ADR 0002 principle 8). Memory creation/editing reuses the existing generic create/edit dialog (`CREATABLE_TYPES`, `FIELDS.memory`); its own bespoke tag-manager UI was not built — tags display via the pre-existing `objects.tags` free-text array, and the first-class `tags`/`object_tags` catalogue remains reachable via `/api/tags` for a future dedicated manager.

## Finance design notes

- **One value = one object.** Every financial fact is an `estimate` (a balance, a recurring flow, a goal, an assumption — with its `data_kind`, currency, source and date) or a `transaction` (a dated movement). The Finance lens (`/finance`, `FinanceLens.tsx`) reads them through `src/domain/finance.ts`; nothing it shows is stored.
- **Actual is never mixed.** Net worth, cash, assets, liabilities and monthly income/expenses/cash flow total `actual` values only. Targets are goals (measured against actuals of the same kind), and estimate/scenario/assumption values feed projections — every figure carries its data-kind badge.
- **Currencies are data.** Each value knows its currency; totals convert with the owner's manual FX rates only, and anything without a rate is listed as excluded, never assumed to be in the base currency.
- **Projections are scenarios.** Each scenario compounds today's actual liquid money with its own assumptions (monthly contribution, annual return); each input shows where it came from, and missing inputs are 0 and say so. More scenario variables (income, expenses, purchases, debt) plug into `projectionInputs` — the base for a future simulator.
- Charts (`components/finance/charts.tsx`) use a dedicated, validated categorical set (`CHART_COLORS`), one value axis, hover readouts and a table view; a chart with no data says "Not enough data yet" instead of drawing one. Net worth over time waits for dated snapshots.

## Documents design notes

- A `document` object holds the metadata; its bytes live in the file store. Import (`importDocument`) stores the file, reads the text of plain-text formats only, creates the object through the ordinary API, and removes the file again if that fails.
- **Content search** uses `content_text`: filled for TXT/Markdown/CSV today; `null` for PDFs and images until an extraction/OCR step exists (the architecture point where it plugs in). The library says when a result was found in the content.
- Preview: PDFs in the browser's viewer, raster images, text; everything else shows its facts and a download. SVG and HTML are never rendered inline.
- Relations are ordinary edges: document → project (`references`), memory → document (`supported_by`), document ↔ financial values and transactions (`references`). The "Link to…" control on the detail view picks the edge with `linkPlan` (`src/domain/linking.ts`).
- The Memory constellation already brings a memory's documents and financial objects in as satellites; `buildConstellation`'s `satelliteTypes` option is the extension point for widening (or narrowing) the knowledge graph.

## Timeline design notes

- Bars, milestone diamonds, dependency hairlines, always-visible today line. Default window 2026–2032; quarters on zoom.
- Rows by project. Scenario switch redraws via the engine; slip is a ghost bar from `baseline_date`.
- Mobile: vertical agenda.

## Local-first, practically

- The engine is pure and client-runnable (instant previews).
- TanStack Query persists a read cache (IndexedDB).
- Full portable JSON export/import (versioned, Zod-validated).
- No offline write queue / sync engine in v1.

## Testing strategy

| Layer      | Tool                     | Covers                                                                                                                                                                                                                                                   |
| ---------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine     | Vitest                   | Roll-up, schedule/slip propagation, critical path, capital projection, simulate — property-style cases incl. cycles and lag.                                                                                                                             |
| SQL        | Vitest + PGlite          | Every migration applies cleanly; constraints (acyclic, single-parent CONTAINS, decision-close-needs-rationale, edge type matrix, Memory/tag constraints) reject bad data; RLS denies cross-owner access on every new table (`tests/sql/memory.test.ts`). |
| API        | Vitest                   | Route handlers with a real (PGlite) database, incl. Memory CRUD, tag CRUD/attach/detach, and unified search (`tests/api/memory.test.ts`, `tags.test.ts`, `search.test.ts`).                                                                              |
| Components | Vitest + Testing Library | States: default, hover, selected, disabled, loading, empty, error.                                                                                                                                                                                       |
| Flows      | Playwright               | F1–F5, project creation → appears in Projects/Map/Graph/Timeline.                                                                                                                                                                                        |
| A11y       | axe in Playwright        | Every surface.                                                                                                                                                                                                                                           |

## Phases

| #   | Phase                                                                                                           | Status                            |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Audit blueprint + repository                                                                                    | ✅                                |
| 2   | Repo bootstrap, docs skeleton, tooling                                                                          | ✅                                |
| 3   | Object + relation store: schema, migrations, Zod types, `/objects` API, domain engine core                      | ✅ (3a domain · 3b SQL · 3c API)  |
| 4   | Shell + design system: tokens, sidebar, top bar, ScenarioSwitch, ⌘K palette, PeekPanel, atoms, canvas contracts | ✅ 4a–4e (awaiting visual review) |
| 5   | Projects (grid/list/board), project detail, project creation with location, seed data                           |                                   |
| 6   | Estimates, scenarios, simulate (F3), Finance                                                                    | ✅ Finance (simulate: planned)    |
| 7   | Graph                                                                                                           |                                   |
| 8   | Timeline → Map → Command Center                                                                                 |                                   |
| 9   | Decisions (F5), Risks, Notes, Documents, grounded assistant                                                     | ✅ Documents (assistant: planned) |
| 10  | Testing, accessibility, responsive refinement                                                                   |                                   |
| 11  | Production preparation                                                                                          |                                   |

Order follows the blueprint's build order (store → shell → projects → estimates/scenarios → graph → timeline → map → Command Center → assistant), with Finance made explicit.
