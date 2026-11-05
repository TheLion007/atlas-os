# ADR 0002 — Memory + Knowledge architecture

- **Status:** Accepted (2026-09-23); implemented through Phase G (database, domain, services, search, retrieval foundation, tests — see §20) and then Phase I (the Memory Storage/Grid/Graph UI, project-colour and multi-project context end to end, creation/editing/archiving — see §21). The AI-proposal card and any LLM connection are deliberately **not** built — a separate, future approval.
- **Scope:** the data architecture, provenance, relationships, tags, search, retrieval foundations, and the Memory Storage/Graph UI. No LLM was connected.
- **Sources:** the Memory + Knowledge brief (2026-09-23), the existing codebase (audited below), ADR 0001, the product owner's approval (2026-09-23, six decision points resolved — see §19).
- **Priority order when this proposal would conflict with something already accepted:** ADR 0001 → this document → engineering judgement.

## 0. The one decision everything else follows from

**Memory is a new object type on the existing spine (`objects` + `<type>_details` + `edges`), not a second database, not a second graph engine, and not a parallel object model.**

The brief describes "Object Graph" and "Memory Graph" as two systems. Architecturally they are **one graph with two lenses over it**: Memory objects are rows in the same `objects` table, related to everything else through the same `edges` table, secured by the same RLS policies, indexed by the same search column, and rendered by the same graph-canvas engine with a different filter and palette applied. This is not a simplification made to save work — it is what "ONE ATLAS, MULTIPLE LENSES" (brief §2) and "do not create a second incompatible database model" (brief §25) require, and it is the pattern the codebase already uses for every other kind of data (see §1).

Every section below is a consequence of this decision, chosen by finding the closest existing precedent in the codebase and extending it, rather than inventing a parallel mechanism.

---

## 1. Audit — what already exists and what Memory reuses

| Area                                                                                                                                                                                                                                                                                                                                                                               | Current state                                                                                                                                                                                                                                                                                                                                                                                      | What Memory reuses                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Object spine** (`db/migrations/20260921120100_objects_and_details.sql`)                                                                                                                                                                                                                                                                                                          | One `objects` table (id, type, title ≤200 chars, status, `tags text[]`, **`confidence smallint 0–100`**, generated `search` tsvector, owner_id, timestamps, soft delete) + one `<type>_details` table per type carrying only type-specific fields. 14 object types today.                                                                                                                          | Memory becomes object type **#15**. It gets a title (the statement itself — the 200-char cap is a _feature_: it forces atomicity, see §17), status, tags, and — critically — **confidence for free**. No new confidence column, no new confidence UI: `src/domain/confidence.ts`'s bands (`high ≥ 75`, `medium 45–74`, `low < 45`, `unset`) already implement exactly what brief §4's "Confidence: High" example needs.                            |
| **Edges** (`20260921120200_edges.sql`, `src/domain/edge-rules.ts`)                                                                                                                                                                                                                                                                                                                 | 6 typed kinds (`contains`, `depends_on`, `estimates`, `funded_by`, `located_at`, `references`), a DB `edge_rules` table enforcing legal (kind, from_type, to_type) triples, cycle prevention for `contains`/`depends_on`, single-parent for `contains`, soft-delete cascade, and a generic `references` (any→any) kind carrying a free `label` (already used for `assignee`/`owner`, ADR 0001 F6). | The "Object Graph ↔ Memory Graph" connection (brief §3) is edges, exactly like every other relationship in Atlas. See §3 below for the specific new kinds proposed.                                                                                                                                                                                                                                                                                |
| **Confidence** (`src/domain/confidence.ts`)                                                                                                                                                                                                                                                                                                                                        | Already a spine-level, type-agnostic 0–100 score with banding, built for the blueprint's ConfidenceMeter.                                                                                                                                                                                                                                                                                          | Reused as-is. Zero new code.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Search** (`objects.search` tsvector generated from `title + search_text`, GIN + trigram indexes; `src/domain/search-text.ts` builds `search_text` per type; `src/domain/search.ts`'s `searchObjects()` ranks already-loaded nodes client-side, with a docstring that already anticipates _"a server-side `/api/search` will replace this when the dataset outgrows the client"_) | Memory needs one new `case "memory":` in `search-text.ts` and is otherwise searchable immediately, for free, because `searchObjects` is already type-agnostic. The anticipated server-side search endpoint is exactly what brief §9–§11 (Unified Atlas Search) asks for — this was already the plan.                                                                                               |
| **Command palette** (`src/components/shell/CommandPalette.tsx`, `palette-items.ts`)                                                                                                                                                                                                                                                                                                | ⌘K, keyboard-first, groups results by type, `>` for actions, recent items, create shortcuts. Built on `searchObjects`.                                                                                                                                                                                                                                                                             | Memory results appear in the palette the moment the type exists — no palette code changes required for basic inclusion. Extending it to jump straight to the Memory inspector is a small, additive change (§9 below).                                                                                                                                                                                                                              |
| **Graph** (`src/components/lenses/GraphLens.tsx`, `src/components/canvases/GraphCanvas.tsx` + `graph-view.ts`)                                                                                                                                                                                                                                                                     | d3-force layout, pan/zoom/drag, focus mode, "show causes" chain, per-type legend that doubles as a show/hide filter, ego-layout fallback on narrow screens, URL-persisted selection.                                                                                                                                                                                                               | The Memory Graph (brief §12–§13) reuses this engine wholesale: same canvas, same interaction vocabulary, a different node-color function and a bounded/filtered node set. The existing per-type hide toggle already means a user can show Memory nodes _inside_ the main Atlas Graph with no new code, the day the type exists.                                                                                                                    |
| **AI assistant UI** (`src/components/shell/AIThread.tsx`)                                                                                                                                                                                                                                                                                                                          | **Already built**, already wired to the "grounded or refused" principle brief §28 asks for: an answer is prose interleaved with `ObjectChip` citations; an answer with zero citations renders as a refusal, never as an assertion. Currently has no backend (`onAsk` is undefined ⇒ composer disabled, "not connected").                                                                           | This is the single biggest reuse opportunity in the whole proposal. The retrieval engine (§8 below) needs to produce exactly one shape: an ordered list of cited objects/memories plus text. That shape already exists (`ChipRef` in `command-center.ts`, `ChipObject` in `AIThread.tsx`) and the UI that renders it is already built and tested. Wiring the assistant is "write the retrieval function and call `onAsk`", not "design a chat UI." |
| **Nav / IA** (`src/components/shell/nav.ts`)                                                                                                                                                                                                                                                                                                                                       | Two flat registers: `LENSES` (Overview, Map, Graph, Timeline — views of one dataset) and `COLLECTIONS` (typed tables: Projects, Tasks, Decisions, Risks, Notes, Documents). `ready: false` items are visible but unlinked, labelled with the phase that ships them (Documents is `phase: 9`, Finance is `phase: 6`) — this is the existing mechanism for "announce the shape before it's built."   | Memory is added to `LENSES`, per brief §29's explicit instruction that it must feel like a lens, not a collection. It can ship as `ready: false` first (visible, phase-labelled) exactly like Documents and Finance did, which lets the nav entry land before the full Memory Core screen does.                                                                                                                                                    |
| **Object-type design tokens** (`src/design/object-types.ts`, enforced by `design-rules.test.ts`)                                                                                                                                                                                                                                                                                   | A muted, cool, low-chroma colour + glyph per object type, found by constrained search, tested for mutual distinctness and contrast. **No per-object or per-project colour exists anywhere today** — colour is purely a function of `type`.                                                                                                                                                         | This is the one area with no existing precedent to extend — see §6 (Project/context colour) for a new, narrow mechanism proposed to fit inside the same constraints (no raw hex outside `src/design/`, no gradients, low chroma).                                                                                                                                                                                                                  |
| **Tags** (`objects.tags text[]`, fed into `search_text` by `search-text.ts`, a `atlas:`-prefixed reserved-tag convention already used to mark example/demo data and hidden from users via `visibleTags()`)                                                                                                                                                                         | Tags exist in the schema and are already indexed for search, but **no tag catalogue, no UI to filter by tag, and no system/user distinction exists yet.** This is mostly untouched ground.                                                                                                                                                                                                         | See §5 (Tag system) — the existing reserved-prefix convention is a precedent for _keeping bookkeeping tags invisible_, not for the system/user tag split itself, which is new.                                                                                                                                                                                                                                                                     |
| **Activity log** (`activity_log` table + triggers on every table, already capturing created/updated/deleted/related/unrelated with a JSON diff, owner-isolated)                                                                                                                                                                                                                    | Full, working audit trail with zero Memory-specific code.                                                                                                                                                                                                                                                                                                                                          | Gives brief §23 (Memory Timeline: createdAt/updatedAt/lastAccessedAt/archivedAt) three of its four fields for free (`created_at`/`updated_at` on the spine, full history in `activity_log`). Only `last_accessed_at` is genuinely new (see §2).                                                                                                                                                                                                    |
| **RLS / auth** (`20260921120400_security.sql`, `src/server/auth.ts`, `src/server/session.ts`)                                                                                                                                                                                                                                                                                      | Owner-only RLS policy looped over every table; `anon` gets nothing; deny-by-default API; single-user model; dev-only owner bypass excluded in production.                                                                                                                                                                                                                                          | New tables join the existing `foreach` loop. Nothing new to design (brief §24 is satisfied by inheritance, not by new work).                                                                                                                                                                                                                                                                                                                       |
| **Creation flow** (`src/domain/creation.ts`, `CREATABLE_TYPES`, `relationForChild`, `quickChildren`)                                                                                                                                                                                                                                                                               | Data-driven: creating an object inside another infers the one legal edge kind from `edge-rules.ts`; no edge-kind picker is ever shown to the user.                                                                                                                                                                                                                                                 | `"memory"` joins `CREATABLE_TYPES`; `relationForChild`/`quickChildren` get one new case so "New memory" appears as a quick action inside a Project, Location, Decision, etc.                                                                                                                                                                                                                                                                       |
| **i18n** (`src/i18n/messages/*.ts`, `area()` parity-checked EN/FR catalogue, AST scanner banning hardcoded UI strings)                                                                                                                                                                                                                                                             | Mature, enforced by two separate tests already.                                                                                                                                                                                                                                                                                                                                                    | New catalogue keys only (`memory.*`, `type.memory`, `types.memory`, tag-manager copy). User-authored memory content is never translated — same rule already applied to every object title.                                                                                                                                                                                                                                                         |
| **AI / embeddings dependencies**                                                                                                                                                                                                                                                                                                                                                   | **None.** No LLM SDK, no `pgvector`, no embeddings library in `package.json`. `pg_trgm` **is** already enabled (used for title fuzzy-matching).                                                                                                                                                                                                                                                    | Confirms the brief's own instruction (§18, §28): retrieval must work by structure first. Semantic similarity is designed as an optional, later tier (§9), not a dependency of anything proposed here.                                                                                                                                                                                                                                              |
| **Documents**                                                                                                                                                                                                                                                                                                                                                                      | `document_details` table exists (mime, size, issuer, validity, storage path, checksum) but the Documents _collection page_ is `ready: false, phase: 9` — the type exists, the UI doesn't yet.                                                                                                                                                                                                      | Memory→Document `supported_by` edges (§3, §21) work against the API today even before the Documents UI ships; full "open the source document" UX benefits from Documents phase 9 but doesn't require it to be built first.                                                                                                                                                                                                                         |

---

## 2. Proposed Memory data model

One new object type, following the exact shape of every existing type (spine row + details row):

```sql
create type public.memory_type as enum (
  'fact', 'preference', 'goal', 'plan', 'constraint', 'insight'
);

create type public.memory_source_kind as enum ('user', 'ai_proposal', 'import');

create table public.memory_details (
  id uuid primary key,
  type public.object_type not null default 'memory' check (type = 'memory'),
  owner_id uuid not null default auth.uid(),
  memory_type public.memory_type not null default 'fact',
  -- A short elaboration beyond the atomic statement in objects.title. Optional on purpose.
  detail text not null default '' check (char_length(detail) <= 1000),
  source_kind public.memory_source_kind not null default 'user',
  pinned boolean not null default false,
  -- Touched by the retrieval engine (§8), not by ordinary reads. Powers "recently used" (§23).
  last_accessed_at timestamptz,
  foreign key (id, type, owner_id) references public.objects (id, type, owner_id) on delete cascade
);
```

Reused rather than reinvented:

- **The statement itself** is `objects.title` (≤200 chars). This is deliberate, not a limitation: it is the mechanism that keeps a memory atomic. Something too long to fit is a Note, not a Memory (§17).
- **Confidence** is `objects.confidence` (0–100) + `src/domain/confidence.ts`'s existing bands. No new column.
- **Lifecycle** is `objects.status`, given Memory-specific meaning rather than a new enum:
  | Status    | Meaning for a memory                                                  |
  | --------- | --------------------------------------------------------------------- |
  | `draft`   | Saved but not yet reviewed/confirmed by the user (e.g. bulk-imported) |
  | `active`  | Current knowledge                                                     |
  | `done`    | A goal/plan that has been fulfilled — kept, not deleted, for history  |
  | `dropped` | **Archived** (brief §5's "Archive" action maps here)                  |
- **Soft delete** is `objects.deleted_at` (already cascades to edges).
- **Provenance ("why does Atlas remember this", brief §4)** is _not_ a free-text field. It is:
  1. `source_kind` — who/what created it (user / an accepted AI proposal / an import).
  2. A `derived_from` edge (§3) to the object it was extracted from, if any — the UI renders this as the "Source: Dorsel Relocation → Strategy" breadcrumb from the brief's own example.
  3. `created_at` (already exists).

### Why this set of six memory types, not the brief's nine

The brief lists FACT, PREFERENCE, DECISION, GOAL, PLAN, CONSTRAINT, INSIGHT, CONTEXT, LESSON and explicitly asks for an audited, minimal set (§16). Cutting three:

- **DECISION** — Atlas already has a full `Decision` object type (options, criteria, scoring, resolution, rationale). A memory-type called "decision" would either duplicate it or become a pointer to it — the latter is just a `derived_from` edge to an existing Decision object. No new type needed.
- **CONTEXT** — too broad to be a real category; every memory has context (its tags and `about` edges). Keeping it as a type would make it the default everyone reaches for, defeating the purpose of having types.
- **LESSON** — a specific case of INSIGHT ("what I learned" vs. "what I've noticed"); merging avoids a distinction users would apply inconsistently.

## 3. Proposed memory/object relationship model

Three new edge kinds, extending the existing 6:

| Kind           | From → To                  | Meaning                                                                                                                                                                                                                 |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `about`        | `memory → any object type` | What this knowledge concerns. Multiple allowed (brief §15: a memory can be about several things).                                                                                                                       |
| `supported_by` | `memory → document`        | The source material backing the statement (brief §21's exact example).                                                                                                                                                  |
| `derived_from` | `memory → any object type` | What this memory was extracted from (a Project, a Decision, a Note...). Distinct from `about`: a memory can be _about_ a project while being _derived from_ a specific Decision inside it. This is the provenance edge. |

Neither is acyclic or single-parent (same category as `located_at`/`estimates`/`funded_by`) — no changes to `ACYCLIC_KINDS`/`SINGLE_PARENT_KINDS`.

**Decision point (needs your sign-off, see §17):** this grows the shared `edge_kind` enum, which the blueprint originally fixed at 6 values (ADR 0001 F1). ADR 0001 already established the precedent of resolving blueprint gaps by extension (F6 added `references`+`label` for assignee/owner instead of a new kind) — the alternative here is to _not_ add new kinds and instead use `references` with reserved, app-validated label values (`about`, `supported_by`, `derived_from`). I recommend the **new-kinds route** because retrieval (§8) needs to filter by relationship kind reliably and cheaply (the existing `edges_from_idx`/`edges_to_idx` are indexed on `(from_id, kind)`/`(to_id, kind)`), and because `edge_rules` can then enforce `supported_by`'s target must be a `document` at the database level, which a string label cannot. The lighter-weight alternative is documented here in case you'd rather not grow that enum.

### Multiple contexts (brief §15)

A memory may have several `about` edges. Rule, made deterministic rather than left to "pick whichever":

- **Primary context** = the `about` edge whose `label = 'primary'` (reusing the edge table's existing free `label` column — the same mechanism `references` already uses for `assignee`/`owner`), or, if none is marked, the **oldest** live `about` edge (stable, no randomness).
- **Display colour** = the primary context's colour (§6), or the Memory type's own default colour if the primary context has none.
- **Secondary contexts** render as small, muted indicator dots — never blended colours (the design system forbids gradients; blending would also produce off-palette hues the design-rules test would reject).

## 4. Proposed tag model

`objects.tags text[]` stays exactly as it is today — including its role in `search-text.ts` — but becomes a **derived cache**, the same relationship `search_text`/`search` already have to the row: the source of truth moves to two new normalised tables, and the service layer keeps `objects.tags` in sync on write (exactly how it already maintains `search_text`).

```sql
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  -- Reserved for a future built-in tag; not used at launch (see below).
  kind text not null default 'user' check (kind in ('system', 'user')),
  -- A token key into a small design-system palette (see §6) — never a raw hex.
  color text,
  created_at timestamptz not null default now(),
  unique (owner_id, lower(name))
);

create table public.object_tags (
  object_id uuid not null references public.objects (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  primary key (object_id, tag_id)
);
```

**System tags are computed, not stored.** `#project`, `#task`, `#document`, `#decision`, `#risk`, `#location` etc. are a presentational alias over `object.type` — shown with a `#` prefix in the tag UI and usable in the same filter/search box, but never written as rows. This avoids an entire class of bugs (deleting or renaming a "system tag", a user tag colliding with one) for something that already has an authoritative source (`object.type`). The `tags.kind` column stays in the schema for a possible future built-in tag Atlas assigns itself (not designed here), not for object-type aliases.

Renaming a user tag updates one row in `tags`; every object that carries it is unaffected in `object_tags` (the join is by id) and their `objects.tags` cache is refreshed by the same service-layer step that already recomputes `search_text` on write.

## 5. Proposed context-colour model (brief §6, §14, §15)

New, narrow mechanism — this is the one area with no existing precedent (§1):

- **New spine column**: `objects.color text` (nullable), a **token key**, never a raw hex — consistent with how `design-rules.test.ts` already forbids hex literals outside `src/design/`. Generic on the spine (like `tags`/`confidence` already are) rather than added to individual `<type>_details` tables, because the brief's own examples give colour to a Project _and_ a country-level Location ("Borland"), not to Projects exclusively.
- **UI restricts which types offer a colour picker** (Project, sub-project, Location to start) — a presentation rule, not a schema rule, so nothing stops it from broadening later without a migration.
- A small fixed set of context colours (distinct hues from the object-type palette, so the two never collide visually) lives in `src/design/tokens.ts` as `CONTEXT_COLORS`, e.g. 8 tokens (`purple`, `teal`, `amber`, `rose`, `slate`, `sage`, `clay`, `indigo`) each mapped to one tested hex, chosen the same way `OBJECT_TYPE_STYLE` was (low chroma, contrast-checked, mutually distinct). **The exact hex values are a design decision for the implementation phase**, not fixed here — flagging the mechanism for approval, not the palette.
- `displayColorFor(object)` — a pure function (same shape as `ancestry()` in `map-model.ts`): walk the object's primary containing/context chain (`contains` parent, or a memory's primary `about` target) until a non-null `color` is found; otherwise fall back to the object-type default colour. One function, used by the Graph, Map, and Memory Graph alike.

## 6. Proposed search architecture

Two phases, both extending code that already anticipates this:

**Phase A (ship with Memory, no new infrastructure).** `search-text.ts` gets one new `case "memory":` (pushes `detail` and the memory type into the indexed text). `searchObjects()` in `search.ts` is already type-agnostic — Memory objects are searchable in the command palette and anywhere else that function is used the moment the type exists.

**Phase B (server-side, triggered by scale — brief §26's 1k/10k/100k targets, not by launch).** A `GET /api/search?q=` route backed directly by the columns that already exist: `objects.search` (tsvector, GIN-indexed) via `ts_rank`, and `objects.title` via the existing `pg_trgm` index for fuzzy/typo-tolerant matching. No new extension, no new index family — `pg_trgm` is already `create extension`'d. This is the endpoint `search.ts`'s own docstring already says will eventually exist.

**Progressive tiers**, per brief §10, implemented as ranking, not as separate code paths:

1. Exact title match
2. Full-text match (`tsvector`)
3. Tag match (`#token` in the query parses to an `object_tags` filter, exact and fast)
4. Related-object match (one edge hop from a query-matched object)
5. Object type match (typing "decisions" surfaces the Decisions collection and decision-typed hits)
6. Semantic similarity — **optional, last, off by default** (§9)

## 7. Proposed retrieval engine (brief §18–§20)

A new pure module, `src/domain/retrieval.ts`, built the same way `buildCommandCenter`/`buildMapModel` already are: a deterministic function over the already-loaded graph, unit-testable without a server.

```ts
interface RetrievalBudget {
  maxItems: number; // MAX_CONTEXT_ITEMS
  maxTokens: number; // MAX_TOKENS — estimated (chars / 4), not an LLM call
  maxRelationDepth: number; // MAX_RELATION_DEPTH
  maxDocumentChunks: number; // MAX_DOCUMENT_CHUNKS — reserved, document chunking is not designed here
}

function buildContext(
  query: string,
  ctx: { focusObjectId?: string | null },
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  budget: RetrievalBudget,
): { citations: ChipRef[]; items: RetrievedItem[] };
```

Priority order (brief §19), implemented as weighted, additive scoring — **structure first, semantics last**:

1. Explicit user context (the currently peeked/open object)
2. Direct object relationship (edges within `maxRelationDepth` hops of the context)
3. Project relationship (`contains`/`about` chain up to a project)
4. Location relationship (`located_at` chain)
5. User tags (shared tags between context and candidate)
6. Object type (query names a type)
7. Recency (`updatedAt`)
8. Confidence (prefers higher-confidence memories when the budget forces truncation)
9. Semantic similarity — **only contributes if an embeddings phase is later approved and enabled; contributes 0 otherwise**, so the engine is fully functional with zero AI dependency by default (brief §8, §34)

The budget constants are named, exported, and env-overridable — the same pattern `SEARCH_TEXT_MAX` in `search-text.ts` already uses for "a limit that must never silently disappear."

**The output is not new.** `citations: ChipRef[]` is `command-center.ts`'s existing `ChipRef` type; it maps directly onto `AIThread.tsx`'s existing `ChipObject` citations. Wiring the assistant becomes: retrieval engine → `onAsk` handler → optional LLM call with the retrieved text → render into the already-built, already-tested `AIThread` component. No UI work is implied by this proposal.

## 8. Proposed Memory Graph architecture (brief §12–§13)

Not a new rendering engine. `GraphCanvas.tsx` (d3-force, pan/zoom/drag, focus mode, causes chain) is reused with:

- A **node filter**: Memory objects plus their one- or two-hop `about`/`supported_by`/`derived_from`/`references` neighbours, not the whole graph.
- A **colour function swap**: nodes coloured by `displayColorFor()` (§5, context-derived) instead of by object type — this is the one real visual difference between `/graph` and `/memory`.
- The existing focus-mode / ego-layout / type-legend-as-filter mechanics apply unchanged.

Because Memory objects are ordinary objects in the same graph, **the existing `/graph` type-legend filter already lets a user show Memory nodes inside the main Atlas Graph** the moment the type exists — no code change needed for that specific integration point (brief §27's "they can reference each other" is satisfied structurally, not by new UI).

At scale (brief §26), the Memory Graph does **not** load every memory client-side: it requests a bounded subgraph — `GET /api/graph?types=memory,project,location&about=<id>&depth=2` — using a server-side recursive CTE. This is not new SQL technique: `validate_edge()`'s cycle check (`20260921120200_edges.sql`) already contains a recursive `with recursive` walk over `edges`; the bounded-traversal query is the same idea run forward from a seed node instead of backward for cycle detection.

## 9. Proposed provenance / "why does Atlas remember this" system

Entirely a _rendering_ concern over data described in §2–§3 — no new storage:

```
MEMORY "Purchase property before relocation"
  Source:      derived_from → Dorsel Relocation → Strategy   (or "You", if source_kind = 'user')
  Confidence:  High (objects.confidence = 82 → confidenceBand())
  Created:     objects.created_at
  Updated:     objects.updated_at
  Related:     about → [Dorsel Relocation, Dorsel property, Financial plan]
```

## 10. Required database migrations (proposed, not written)

One migration set, following the existing five-file split by concern:

1. `..._memory_enums.sql` — `memory_type`, `memory_source_kind` enums; add `'memory'` to `object_type`.
2. `..._memory_details.sql` — the `memory_details` table (§2).
3. `..._memory_edges.sql` — add `about`, `supported_by`, `derived_from` to `edge_kind`; `edge_rules` rows for each (§3).
4. `..._tags.sql` — `tags`, `object_tags` tables (§4); `objects.color` column (§5).
5. `..._memory_security.sql` — add `memory_details`, `tags`, `object_tags` to the existing owner-RLS `foreach` loop; wire the existing `log_activity()` trigger onto `memory_details` (one `create trigger ... execute function public.log_activity()` line, matching the other 13).

A test already exists asserting the TS enums and SQL enums stay in sync (referenced in `20260921120000_enums_and_helpers.sql`'s header comment) — it is extended, not replaced, by the new enum values.

## 11. Required API routes/endpoints

| Route                                                           | Notes                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/objects` (existing)                                  | Already generic across types; accepts `type: "memory"` once the Zod schema (§13) is added. No new route.                                                                                                                                               |
| `GET /api/objects?type=memory` (existing)                       | Already generic; works immediately.                                                                                                                                                                                                                    |
| `PATCH/DELETE /api/objects/:id` (existing)                      | Unchanged.                                                                                                                                                                                                                                             |
| `POST /api/edges`, `DELETE /api/edges/:id` (existing)           | Unchanged; used for `about`/`supported_by`/`derived_from`.                                                                                                                                                                                             |
| `GET /api/tags`, `POST /api/tags`, `PATCH/DELETE /api/tags/:id` | **New** — CRUD for the user tag catalogue (§4).                                                                                                                                                                                                        |
| `GET /api/search?q=`                                            | **New**, Phase B only (§6) — server-side tsvector/trigram search across all types.                                                                                                                                                                     |
| `GET /api/graph?types=&about=&depth=`                           | **New**, bounded-subgraph variant of the existing `/api/graph` for Memory Graph at scale (§8); the existing unbounded route is untouched for the main Atlas Graph.                                                                                     |
| Assistant endpoint (`POST /api/assistant` or similar)           | **Not designed here.** Brief §18 explicitly scopes this proposal to the retrieval architecture, not the LLM integration. Proposed as a distinct, later approval once an LLM provider/env-var design (ADR 0001 R13's already-agreed pattern) is chosen. |

## 12. UI components (proposed inventory, not built)

- `nav.ts`: one new `LENSES` entry, `Memory` → `/memory`, `ready: false` at first (same phased-rollout mechanism as Documents/Finance).
- `MemoryLens` / `/memory` page: search bar (top), `MemoryGraph` canvas (centre, reusing `GraphCanvas`), inspector/peek panel (side, extending the existing `PeekPanel`/`ObjectView` machinery already used for every object type), recent-memories rail (bottom) sourced from `activity_log`.
- `MemoryInspector`: title, type, project/context chip(s) with colour, confidence band, source breadcrumb (§9), tags, related objects/memories — a Memory-specific arrangement of fields already rendered elsewhere for other types (`ObjectView.tsx` patterns).
- `MemoryProposalCard`: "New durable information detected" + the proposed statement + `[Save memory]`/`[Ignore]`, rendered inside `AIThread`. Not persisted unless "Save" is clicked, which calls the existing `POST /api/objects`.
- `TagManager`: create/rename/recolour/delete user tags; list usage counts.
- `CommandPalette`/`palette-items.ts`: extend `objectItem()`'s hint/group logic so a Memory result opens the Memory inspector rather than a generic object page (brief §11) — a small, additive change.
- Empty state for `/memory`, using the existing `EmptyState` component and copy discipline (brief §31: never implies Atlas records everything automatically).

## 13. State management changes

None structurally. The existing `AtlasDataSource` interface (`src/client/*`, backing both the real API and dev fixtures per ADR 0001 R18) already exposes `.graph()`/`.object()`; Memory objects flow through it unchanged. `useGraph()`/`useObject()` need no new hooks. A `useTags()` hook is added, following the exact shape of the existing data hooks in `src/client/hooks.ts`.

## 14. Performance strategy (brief §26)

- List/paginate: `ObjectPage { items, total, limit, offset }` already exists in `api-types.ts` — reused for `GET /api/objects?type=memory` with no changes.
- Full graph load stays fine for the main `/graph` at personal-project scale (unchanged); the Memory Graph gets the bounded server-side query (§8) specifically because Memory is the type most likely to grow into the thousands.
- Search moves server-side (§6 Phase B) exactly when client-side ranking over the full loaded set stops being instant — not before, to avoid speculative infrastructure.
- `last_accessed_at` (§2) is touched by the retrieval engine's own writes (batched), never by an ordinary `GET`, so reading a memory never costs a write.

## 15. Security implications (brief §24)

None beyond "extend the existing pattern": new tables join the owner-RLS `foreach` loop (§10 item 5); `anon` gets nothing, same as every other table; the dev-owner bypass already excludes production. The future assistant reads memory **only** through the retrieval engine (§7), which itself only ever queries through the same owner-scoped `Db` interface every other server code path uses — there is no separate, wider-access path for AI to take.

## 16. Testing strategy

Mirrors five existing, already-established patterns — no new test _infrastructure_:

1. **SQL/enum parity** — extend the existing PGlite-backed test that checks `src/domain/enums.ts` against the database enums, for `memory_type`, `memory_source_kind`, and the three new edge kinds.
2. **Domain unit tests**, co-located `*.test.ts` (existing convention): `retrieval.test.ts`, `context-color.test.ts`, the new `search-text.ts` case, `edge-rules.test.ts` additions.
3. **API route tests** (`tests/api`, existing pattern): memory CRUD via the already-generic `/api/objects` route tests; new tests for `/api/tags` and `/api/search`.
4. **Design-rules test** (`design-rules.test.ts`) — already scans _all_ source for hex-outside-`src/design`/gradients/off-scale spacing; new Memory components are covered automatically, no new test needed.
5. **i18n-guard test** — already scans all source for hardcoded UI strings; new Memory components are covered automatically.
6. **Component tests** (`*-components.test.tsx`, existing convention): `MemoryLens`, `MemoryInspector`, `MemoryProposalCard`, `TagManager`.

## 17. Migration / implementation order (proposed, once approved)

1. This ADR accepted; open decision points (below) resolved.
2. Migration set (§10) — enums, `memory_details`, edge kinds, `tags`/`object_tags`, `objects.color`, RLS, activity-log trigger.
3. Domain layer: `enums.ts`, `schemas.ts` (memory + colour + tag Zod schemas), `search-text.ts` case, `edge-rules.ts` mirror, `creation.ts` (`CREATABLE_TYPES`, `quickChildren`), new `context-color.ts`, new `retrieval.ts`.
4. Server layer: generic object/edge routes pick up the new type with minimal changes; new `/api/tags`; (later) `/api/search`, bounded `/api/graph`.
5. Design: `CONTEXT_COLORS` palette (needs your sign-off on hues), `MEMORY_TYPE_STYLE` (glyph + label per memory type, same shape as `OBJECT_TYPE_STYLE`).
6. UI, roughly in this order: nav entry (`ready: false`) → Memory included in Collections/Graph/Search/Palette via the generic mechanisms above → `MemoryInspector` → `TagManager` → `MemoryProposalCard` → the full `/memory` Memory Core screen (graph + search + rail) → nav entry flipped to `ready: true`.
7. Retrieval engine (§7) — buildable and testable entirely before any LLM is wired in.
8. Assistant wiring (`onAsk`) — separate, later proposal; needs an explicit LLM-provider/env-var decision (ADR 0001 R13 already sets the precedent: optional, key-gated, never fabricated).
9. Memory health (§22 of the brief) — future; sketched in §18 below, not scheduled.

## 18. Risks and trade-offs

| Risk / trade-off                                                                                                | Assessment                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Growing `edge_kind` from 6 to 9 touches a core, well-tested enum.                                               | Mitigated: the DB/TS parity test catches drift immediately; the alternative (labelled `references` edges, no enum growth) is documented in §3 as a fallback if you'd rather not extend it.                        |
| `objects.color` is a new spine column touching a table 14 other types already share.                            | Nullable, additive, no existing row is affected; UI-gated to a few types at first. Lowest-risk kind of spine change.                                                                                              |
| Tag system introduces two new tables alongside the pre-existing `objects.tags`.                                 | Resolved during implementation as two independent, complementary surfaces rather than a cache relationship (see §20) — simpler than the original proposal, and lower-risk since it changes no existing behaviour. |
| Memory could become "a second Notes" if the type boundary isn't enforced.                                       | The 200-char title cap is the enforcement mechanism (§2, §17) — it is a feature, not a limitation, and should not be relaxed.                                                                                     |
| AI-proposal flow could be built to auto-save "for convenience" later, quietly violating brief §5/§34.           | Architecturally prevented, not just policy: nothing designed here persists a proposal before `POST /api/objects` is explicitly called by a "Save" click. There is no proposal table to "just start writing to."   |
| Retrieval engine's scoring weights (§7's 9-tier order) are a judgement call with no existing precedent to copy. | Being a pure, unit-tested function, the weights are easy to tune later without touching storage or the UI — the _shape_ is the durable decision, the _weights_ are not.                                           |
| Memory Graph reusing `GraphCanvas` could tempt scope creep into "redesign the graph engine."                    | Explicitly scoped in §8 to a filter + colour-function change. If the visual target (brief §12) turns out to need more than that once built, that is a separate, later proposal — not assumed here.                |

---

## 19. Approved decisions (2026-09-23)

The six open decision points were resolved by the product owner before implementation began:

1. **Edge kinds:** dedicated typed kinds (`about`, `supported_by`, `derived_from`) — the labelled-`references` alternative was declined.
2. **Memory types:** the proposed six, unchanged — `fact · preference · goal · plan · constraint · insight`. `decision` stays a `derived_from` link to the existing Decision object; no generic `context` type; `lesson` stays folded into `insight`.
3. **Context colour ownership:** narrowed from the proposal's `project, sub_project, location` to **`project, sub_project` only**. Locations were explicitly excluded — they are shared across projects and must not become a colour authority. This also settled §3's multi-context rule: a Memory's colour comes from a Project/Sub-project it is `about`, never from a Location, even when one is linked.
4. **Context-colour palette:** the token mechanism was approved; the exact hues remain deferred to a future design pass. A provisional eight-colour set was still produced (§5, `CONTEXT_COLORS`) so the mechanism is genuinely usable now, explicitly marked revisable.
5. **Navigation:** stricter than the proposal's "ship `ready: false` like Documents/Finance" default — **no nav entry at all** yet, not even an unlinked one. Memory stays reachable only through the API until the full Memory Core screen exists.
6. **Assistant wiring:** confirmed out of scope. This ADR builds the data model, provenance, relationships, tags, search and the retrieval foundation only; connecting an LLM is a separate, future approval.

## 20. Implementation notes

Two things changed between the proposal and the build, both because implementation surfaced a concrete detail the proposal hadn't (per the instruction to report rather than silently redesign):

- **§4's "cache" framing was dropped.** The proposal described `objects.tags` becoming a denormalised cache of the new `object_tags` catalogue, mirroring `search_text`. Building the tag service revealed that `objects.tags` is not a passive, service-only column: it is already a live, tested, directly user-settable field on every object create/update (and it carries the pre-existing `atlas:`-prefixed reserved-tag mechanism from `src/domain/creation.ts`, used for marking example data). Turning it into a cache would have meant changing that existing, working, tested behaviour — a bigger and riskier change than Memory required. **Resolution:** the two are independent, complementary tagging surfaces. `objects.tags` is untouched; `tags`/`object_tags` is the new first-class catalogue; `GET /api/search` reads both so nothing is lost. Documented in `src/server/objects/tags.ts`.
- **A genuine SQL bug, not a design question:** `unique (owner_id, lower(name))` is not valid as a table-level `UNIQUE` constraint (Postgres constraints take column names, not expressions). Fixed as a `create unique index ... (owner_id, lower(name))` instead — same guarantee, correct syntax. Caught immediately by the SQL test suite (PGlite failed to apply the migration).

Everything else — the memory type set, the three new edge kinds and their legal targets, the confidence/status reuse, the provenance model, the retrieval priority order and budget, the search architecture — was built exactly as proposed.

### What was built (Phases A–G)

- **Migrations** (`db/migrations/20260923*.sql`): `memory_type`/`memory_source_kind` enums; `object_type` gains `memory`; `edge_kind` gains `about`/`supported_by`/`derived_from`; `memory_details`; `tags`/`object_tags` with an owner-match trigger; `objects.color` with its format and type-restriction checks; `edge_rules` rows for the new kinds and for the pre-existing `estimates`/`references` "any type" rules now that `memory` exists; RLS extended to all three new tables.
- **Domain** (`src/domain/`): `enums.ts`, `schemas.ts` (memory details, colour, tag schemas, the project/sub_project-only colour rule), `edge-rules.ts`, `search-text.ts`, plus three new pure modules — `context-color.ts` (colour derivation), `memory.ts` (provenance), `retrieval.ts` (the budgeted, ranked, cited context builder).
- **Server** (`src/server/objects/`): `tags.ts` (catalogue CRUD + attach/detach), `search.ts` (unified server-side search); `service.ts`/`read-models.ts`/`mapping.ts` extended for `color` and the `memory` type.
- **API routes:** `GET/POST /api/tags`, `PATCH/DELETE /api/tags/:id`, `POST /api/objects/:id/tags`, `DELETE /api/objects/:id/tags/:tagId`, `GET /api/search`. `/api/objects` and `/api/edges` needed no new routes — Memory flows through the existing generic ones.
- **Design** (`src/design/`): `memory` added to `OBJECT_TYPE_STYLE` (a new "knowledge" family, `#A1D4E6`, verified against the same chroma/contrast/distinctness maths as the rest of the palette) and to `TypeGlyph`; `CONTEXT_COLORS` added to `tokens.ts`.
- **Tests:** `tests/sql/memory.test.ts` (constraints, edge rules, RLS/owner isolation for the three new tables), `tests/api/memory.test.ts` (create/update/archive/delete, relationships, cross-owner isolation), `tests/api/tags.test.ts`, `tests/api/search.test.ts`, plus co-located unit tests for `context-color.ts`, `memory.ts`, `retrieval.ts` and `search.ts`'s query parser. The existing suite (schema parity, edge-rules parity, design-rules, i18n-guard) needed only mechanical extensions (new type/kind added to fixtures and expectation lists), not weakening.
- **Seed data:** two illustrative memories (`mem_plan`, `mem_cash`) added to `src/seed/illustrative.ts`, exercising `about`/`derived_from`/`supported_by` and colour inheritance from "Dorsel relocation" (`color: "purple"`), and covering the existing "every object type appears in the seed" test.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build`, and the full test suite (841/841) all clean. Nothing in `src/components/`, `src/app/(shell)/`, or `src/components/shell/nav.ts` changed — Overview, Graph, Map, Timeline and Projects are exactly as they were.

## 21. Memory Storage, Search Integration and the Memory Graph — Phase I (2026-09-24)

Phases A–H built the full data architecture with **no UI**, per the standing instruction not to build `/memory` yet. This phase was asked explicitly to build that UI: a real Storage experience (browse/search/filter/sort/group/inspect), project colour genuinely visible, multi-project memories usable end to end, and the Memory Graph as a lens over the same objects — plus to audit first and reuse rather than duplicate.

### Audit: what already existed vs. what was missing

| Already built (Phases A–H)                                                                                                                         | Missing before this phase                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The full data model: `memory` type, `about`/`supported_by`/`derived_from` edges, confidence/status/tags reuse, `objects.color`, the tag catalogue. | Any screen to browse, filter, sort or create a memory. `MemoryLens`/`/memory` did not exist.                                      |
| `context-color.ts` (colour derivation) and `memory.ts` (provenance) as pure functions.                                                             | Nowhere in the UI called them — no object page showed a memory's context or provenance.                                           |
| `retrieval.ts` (the future assistant's context builder).                                                                                           | Unrelated to this phase; untouched (still no LLM).                                                                                |
| Full CRUD via the generic `/api/objects`/`/api/edges`/`/api/tags` routes.                                                                          | `memory` was not in `CREATABLE_TYPES` — there was no form to create or edit one, and no way to set a primary project at creation. |
| `GraphCanvas` (the shared force-directed engine).                                                                                                  | No filtered "Memory Graph" view existed; nothing derived a memory-scoped subgraph.                                                |
| The command palette and `searchObjects()` were already type-agnostic.                                                                              | Never exercised for memory in the running app, and nothing routed a click through to a memory-aware detail view.                  |

### What was implemented

- **`src/domain/memory-model.ts`** (new): `MemoryRow` — one row per memory, combining `resolveMemoryContext()` and `memoryProvenance()` with tag/relationship counts. `filterMemoryRows()` (query, project — including "no project" — type, confidence band, status, all composable), `sortMemoryRows()` (updated/created/alphabetical/confidence/relevance, the last folding in `searchObjects()`'s ranking rather than inventing a second one), `groupMemoryRowsByContext()`, and `memoryGraphSubset()` (a bounded BFS over `about`/`supported_by`/`derived_from`/`references` edges — the Memory Graph's data, not a new traversal engine).
- **`src/domain/memory-health.ts`** (new): `analyzeMemoryHealth()` — duplicate (near-identical title, same type), low/unset confidence, stale (>180 days unchanged), orphaned (zero relationships), and a `possible_contradiction` heuristic (same project, same type, a shared tag) — a prompt, never a resolution. `unused` stays in the `MemoryHealthKind` union but is deliberately never emitted yet: nothing writes `last_accessed_at` until retrieval has a real consumer, so firing it today would flag every memory as noise.
- **`src/components/lenses/MemoryLens.tsx`** (new) + **`src/app/(shell)/memory/page.tsx`** (new route) + **`nav.ts`**: the Memory Core — search, four composable filters, five sorts, a health-flag strip (click a flag to isolate it, click "flagged only" to see everything flagged), and List/Grid/Graph views over the identical `MemoryRow[]`. Added to `LENSES` as a first-class entry (`ready: true`) per this phase's explicit instruction — a change from Phase H's "no nav entry at all."
- **Creation, editing, archiving, deletion** — no new dialog was built. `memory` joined `CREATABLE_TYPES`; `relationForChild()` gained an `about` branch (a memory's "parent" pick becomes its primary `about` edge, labelled `"primary"`); `form-spec.ts` gained `FIELDS.memory`/`RELATIONS.memory` (statement, type, confidence, detail, status, tags, primary project) and a `case "memory"` in `detailsFor()` that preserves `sourceKind`/`pinned` on edit rather than resetting them — provenance is not decorative, so editing a memory must not silently erase how it was sourced. This is the **first type for which the create form accepts a confidence value**; `buildObject()`/`EditForm` were extended generically (gated on `FIELDS[type]` containing a `confidence` field), so every other type is unaffected.
- **Memory Detail** (`ObjectView.tsx`, wired from both `ObjectPageView.tsx` and `PeekPanel.tsx`, which already computed `facts` the same way): a `MemorySection` renders when `object.type === "memory"` — primary/secondary project chips (colour-dotted via a new `ObjectChip` `contextColor` prop), an `AddContextControl` (a `<select>` + `useCreateEdge()`) to attach a secondary project post-creation, and a Provenance block (source-kind sentence + `derived_from`/`supported_by` chips). The header's type glyph also carries the resolved colour as a small dot. This is the **first place in the app that creates an edge between two already-existing objects outside the create dialog** — `useCreateEdge()` existed (Phase C) but had never been called from a component.
- **Search**: no second search system. The command palette already worked for memory once the type existed; this phase only confirmed it end-to-end in a real browser (⌘K → "MEMORIES" group → opens the object).
- **Memory Graph**: `GraphCanvas` reused with zero changes, fed `memoryGraphSubset()`'s bounded node/edge set.

### Scoping decisions made during implementation (reported, not silently expanded)

- **No generic "add any relation" UI was built.** `RelationList`'s `onAdd`/`addSlot` props exist but were, before and after this phase, exercised only in tests — no type in the app can add a relation of a kind it doesn't already have one of. Building that generically was out of scope (a cross-cutting, pre-existing gap, not specific to Memory); the targeted `AddContextControl` above covers the one case the brief specifically asked for (secondary project context) without it.
- **No per-node colouring in the Memory Graph.** As flagged as a risk in §18, `graph-engine.ts`'s shared colour-by-type model was left untouched; memory nodes are distinguished by their own "knowledge" type colour, not by inherited project colour, inside the graph canvas specifically (Storage's List/Grid views, and the object detail page, do show the real inherited colour).
- **No bespoke tag-manager UI.** Tags display via the pre-existing `objects.tags` free-text array (already visible on every object, including memory, via `ObjectView`'s existing tag chips) rather than a new UI for the `tags`/`object_tags` catalogue, which remains reachable through `/api/tags` for a future dedicated manager.
- **Live-verified, not just unit-tested**: created a real multi-project memory in a running browser (primary = Dorsel relocation, confidence 70 → inherited purple, medium band), added a secondary context (Ironfield flat sale) via `AddContextControl`, confirmed the Memory Graph updated live, confirmed project filtering (both "has as primary" and "has as secondary" cases), free-text search, and the ⌘K palette — all against the same illustrative dataset, no mocks.

### Tests added

`memory-model.test.ts` (rows, filters incl. composition, every sort, grouping, graph subset at two depths), `memory-health.test.ts` (every flag kind, archived memories excluded, contradiction requires project+type+tag overlap), `MemoryLens.test.tsx` (renders from the shared graph, project/type/query filtering, view switching, wires to the shared create dialog), plus extensions to `creation.test.ts` (the new `about` relation, `quickChildren`) and mechanical updates to `shell-logic.test.ts`/`shell-components.test.tsx` for the fifth lens.

Verified: `tsc --noEmit`, `eslint .`, `prettier --check .`, `next build`, and the full suite (877/877) all clean.
