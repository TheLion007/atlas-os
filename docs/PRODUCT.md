# Atlas OS — Product

> A Personal Project Intelligence OS for managing complex, long-term projects through interconnected projects, tasks, finances, estimates, locations, decisions, risks, notes, documents and timelines.

The original design blueprint is not part of this repository. Decisions and deviations: [`decisions/0001-accepted-architecture.md`](./decisions/0001-accepted-architecture.md).

## Positioning

- **Not a workspace, a model.** Notion stores pages; Atlas OS stores a system with consequences. Every number belongs to an estimate, every estimate to a scenario, every scenario to a date.
- **Relations are the primitive.** Objects are cheap; edges are the product. The Graph is the database made legible; the other lenses are projections of it.
- **Calm under a decade of use.** One accent, two surfaces, no chrome competing with data. Boring on day 900, still answering the five questions in ten seconds.
- **Generic by construction.** Long-term planning is the first use case, and the places in the example data are _data_, not architecture: a project in Borland and one in Dorsel (both invented) use identical location, finance and timeline machinery.
- **Single user, private.** All project and financial data is private to its owner.

## The five questions every screen answers

1. Where am I?
2. What is moving?
3. What is blocked?
4. What is next?
5. What does this cost me?

The Command Center additionally answers **what changed recently** (activity).

## Information architecture

Flat by design. Depth comes from relations and search, never from folders.

| Register        | Members                                                                         | Notes                                                                        |
| --------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Lenses**      | Command Center (`/`), Map, Graph, Timeline                                      | Four views of one dataset. Switching a lens preserves selection and filters. |
| **Collections** | Projects, Tasks, Finance, Decisions, Risks, Notes, Documents                    | Typed tables with one shared filter-bar grammar.                             |
| **Ambient**     | Command palette (⌘/Ctrl+K), assistant (⌘/Ctrl+J), object peek (Space), Settings | Summoned, not navigated to. Overlays the lens so context is never lost.      |

Rules: one object, one page; Space peeks, Enter opens; breadcrumbs are a _relation path_, not a folder path; the sidebar collapses to 56px.

## The four lenses

| Lens                    | Question               | Behaviour                                                                                                                                                                                               |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command Center**      | "Where am I?"          | Capital rail with the derived relocation/target date, Focus (the 3 things that matter), next 90 days, projection, risks, decisions, activity. Every tile links to its object.                           |
| **Map**                 | "Where is it?"         | Real-world globe. Earth → country → region → city → district → project. Pins are typed objects. Overlays (yield, price/m²). List synced to viewport. Mobile: list-first.                                |
| **Graph** _(signature)_ | "How is it connected?" | Live force simulation that settles and stays calm. Node size = weight in the plan, colour = type. Select to dim beyond two hops. Path mode traces cause → effect. Drag to pin. Mobile: radial ego-view. |
| **Timeline**            | "When must it happen?" | Bars, milestone diamonds, dependency hairlines, always-visible today line. Scenario redraws the board; slip shows as a ghost bar. Mobile: vertical agenda.                                              |

## Objects (15)

Shared spine on every object: `id · type · title · status · createdAt · updatedAt · tags[] · confidence?` (relations live in the edge table).

Project · Sub-project · Task · Milestone · Estimate · Scenario · Location · Property · Decision · Risk · Note · Document · Person · Event · Dependency (payload of a `DEPENDS_ON` edge; the only object with no page).

## Relations (six typed edges)

| Edge         | Meaning                                                 | Propagation                                                                  |
| ------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `CONTAINS`   | Project → Sub-project → Task (and Location → Location)  | Progress rolls up by weighted effort                                         |
| `DEPENDS_ON` | Hard precedence                                         | Slip propagates forward with lag; blocked state propagates back as a warning |
| `ESTIMATES`  | Estimate → any object                                   | Active scenario selects which estimate shows                                 |
| `FUNDED_BY`  | Cost → capital source                                   | Sums must reconcile; a shortfall renders as a red edge                       |
| `LOCATED_AT` | Any object → Location                                   | Anything with this edge appears on the Map                                   |
| `REFERENCES` | Soft link (notes, documents, decisions, assignee/owner) | Bidirectional, no propagation — the backlink                                 |

Untyped "related to" links are not allowed.

## Data status

Two independent axes, never conflated:

- **Lifecycle `status`** — `draft · active · done · dropped`. ("Blocked" is derived.)
- **Financial `dataKind`** — `actual · target · estimate · scenario · assumption`. The UI and the AI layer must never present an estimate as a confirmed fact.

Every financial value carries: `value · currency · source · asOf · confidence · scenario · dataKind`.

Confidence bands: high ≥ 75 · medium 45–74 · low < 45 · unset.

## Derived, never stored

Project progress · risk level · capital curve per scenario · milestone slip · yield · critical path · blocked state · backlinks. _If a number can be derived, it must be — storing it is how the model starts lying._

### How the derived values are defined

The blueprint names these values but not their rules. These are the rules implemented in `src/domain/engine`, recorded here because several are **assumptions** you may want to change.

| Value               | Rule                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Progress**        | Weighted effort along `CONTAINS`: done effort ÷ total effort. Only tasks carry effort (default weight 1). Dropped tasks are excluded from the total rather than counted as failures. Milestones are gates, not effort. A container with nothing measurable reports **no data**, never 0%. _(Blueprint: "rolls up by weighted effort"; the exclusions are assumptions.)_ |
| **Risk level**      | Score = probability × impact (each 1–5). **low** ≤ 4 · **medium** ≤ 9 · **high** ≤ 16 · **critical** ≥ 20. _(Assumption: the blueprint says only "level (derived)".)_                                                                                                                                                                                                   |
| **Blocked**         | An object is blocked while any `DEPENDS_ON` predecessor is `draft` or `active`. A `dropped` predecessor is reported as a **broken dependency** (it can never be satisfied), not as blocking. Finished or dropped objects are never blocked.                                                                                                                             |
| **Slip**            | Scheduled date − baseline date, in days. Scheduled date = the later of the planned date and every predecessor's scheduled date + lag (negative lag = lead). The predecessor that drove the push is reported so a delay can be traced to objects.                                                                                                                        |
| **Dependency type** | Stored (`fs/ss/ff/sf`) but, until tasks have durations (Timeline phase), all four reduce to "predecessor date + lag".                                                                                                                                                                                                                                                   |

## Core flows (must be frictionless)

| Flow                         | Path                                                                                                               | Target                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| **F1 Morning check-in**      | Command Center → Focus → peek → done or reschedule                                                                 | 40 s, zero page loads          |
| **F2 Capture a find**        | ⌘K → "new property" → inline form → geocode → auto-linked to project and district, estimate stub at 40% confidence | Never leaves the lens          |
| **F3 Test an assumption**    | Pick Conservative → columns recompute → "3 milestones move, 1 decision reopens" → accept or discard                | Always previewed before commit |
| **F4 Understand a blockage** | Flagged milestone → Graph path mode with cause chain lit → assistant explains with objects cited                   | Traceable to objects           |
| **F5 Close a decision**      | Weighted criteria matrix → pick → rationale required → resolution stamps the linked milestone                      | No close without a reason      |

## Project creation

Name · description · status · priority · start/target dates · budget (target) · **location** · tags · relations. Progress is _not_ an input. A new project appears immediately in Projects, and — where applicable — Map (has a location), Graph (always), Timeline (has dates).

## AI

Not a chatbot. It operates on structured Atlas OS data, cites objects inline, and **refuses ungrounded claims**. It never fabricates. First implementation ships the interface, deterministic graph-query tools and the refusal state; LLM synthesis is optional and env-gated.

## Non-goals

A generic page/doc workspace; a broker or trading tool (finance is planning/simulation only); multi-user collaboration; verified market data (all illustrative figures are labelled as such).

## Seed data

Illustrative, clearly labelled, and multi-domain (Borland, Dorsel, real-estate, business, personal, financial planning) so the app is meaningful on first run. **Seed figures are not verified market data.**
