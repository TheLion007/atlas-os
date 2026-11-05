# Atlas OS — Design System

Source: blueprint slide 7 ("Sand on graphite, numbers in mono") and slides 11–13. The visual identity is dark, premium, futuristic-but-calm, architectural and highly readable — a serious professional operating system. Not neon, not gaming, not a generic AI dashboard, no stock shadcn theme.

## Tokens (from the blueprint)

| Token           | Value     | Use                       |
| --------------- | --------- | ------------------------- |
| `bg`            | `#08090B` | App background            |
| `surface`       | `#101216` | Cards, panels, sheets     |
| `border`        | `#20242A` | Hairlines and dividers    |
| `accent` (sand) | `#C8B08A` | The single accent         |
| `positive`      | `#6E9E7F` | Good / on track           |
| `critical`      | `#B4655F` | Bad / shortfall / overrun |

Two surfaces only (`bg`, `surface`). Dark theme is the product; a light theme is out of scope.

Implemented as CSS variables in `src/app/globals.css` and exposed to Tailwind through `@theme static` (`static` so every token is always emitted, not only the ones a utility currently uses). Utilities (`bg-surface`, `text-accent`, `border-border`) and raw CSS therefore share the same values.

**Derived text tokens.** The blueprint defines no text colours, so two are derived to suit the palette and are _not_ blueprint values: `fg` `#E7E5E0` (warm off-white, ≈16:1 on `bg`) and `fg-muted` `#8B9099` (≈6:1 on `bg`). Both clear AA.

**Contrast note (computed, WCAG):** `critical` `#B4655F` is 4.71:1 on `bg` but **4.43:1 on `surface`**, just under AA for small text. Use `critical` for small text only on `bg`; on `surface` pair it with an icon/label and keep it for large or bold text, edges and fills. `accent` (9.5:1), `positive` (6.1–6.5:1) and the text tokens pass everywhere.

## Type

- **Schibsted Grotesk** — interface text.
- **IBM Plex Mono** — every number, currency amount, date and ID. Tabular numerals always.
- Loaded with `next/font` (self-hosted at build, no runtime third-party request).
- Sample: "Dorsel Marina Apartment" (UI) / "€109,400 / €420,000" (mono).

## Space, radius, motion

- Spacing scale: **4 · 8 · 12 · 16 · 24 · 32 · 48 · 72** (no other values).
- Radius: **4** for controls, **8** for cards.
- Motion: hover **120 ms**, panels **220 ms**. **No motion without a state change.** The graph settles and stops.

## Accent discipline

1. Sand marks **one thing per screen**.
2. Never a fill on a large area.
3. Status colours outrank the accent.
4. Charts: sand = actual, grey (hatched) = projected.
5. Colour in the risk matrix appears only in the top-right quadrant.

## Object-type colours

The graph needs "colour = type" across 15 page objects with only six brand tokens. The palette is **muted, cool and restrained**: no bright categorical colours, no warm hues, nothing that competes with sand, positive or critical. It was found by constrained search in OKLCH, grouped by family, and its rules are enforced by tests (`src/design/object-types.test.ts`):

| Family        | Types (colour)                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Structure** | project `#A4B8DA` · sub-project `#648AA1` · task `#7FADBE` · milestone `#5C6182`                                                       |
| **Finance**   | estimate `#8FC2BB` · scenario `#3C6D6E`                                                                                                |
| **Place**     | location `#908EB3` · property `#7D6C8A`                                                                                                |
| **Judgement** | decision `#CDAAC6` · risk `#7C5764`                                                                                                    |
| **Evidence**  | note `#AE9EB1` · document `#8C8085` · person `#B18693` · event `#5B8178`                                                               |
| **Knowledge** | memory `#A1D4E6` — its own family: a memory is not structure, finance, place, judgement or evidence, it is what Atlas knows (ADR 0002) |

Enforced: chroma ≤ 0.06 (muted) · ≥ 3:1 contrast on **both** `bg` and `surface` · ≥ 9 OKLab distance from sand, positive and critical · ≥ 6 between any two types · no hue in the reserved red-orange, sand or green zones · every type also has its **own glyph** (`TypeGlyph`), so colour is never the only cue. The CSS tokens (`--color-type-*`) and the TypeScript colours are asserted equal.

### Where sand goes, per screen

Sand marks exactly one thing per screen, and never the global chrome (sidebar, top bar, focus rings, active nav). Status colours mark **marks** (dots, bars, ticks), never small text, because `critical` on `surface` is 4.43:1.

| Screen       | The one sand element                                  |
| ------------ | ----------------------------------------------------- |
| Overview     | The capital actually in hand (the progress-rail fill) |
| Graph        | The selected node's ring                              |
| Timeline     | The today line                                        |
| Map          | The selected pin's ring                               |
| Object pages | None (sand is not required on every screen)           |

`critical` is used only for real problems: an overdue item, a milestone slipped past its baseline, a shortfall or overrun. A normal dependency wait is **not** critical.

## Context colour (ADR 0002)

Separate from — and deliberately more saturated than — the object-type palette above: an object-type colour is a quiet categorical label the app assigns; a context colour is an identity a **user** picks for something they built ("Dorsel Relocation is purple"), so it is allowed to read as an actual colour rather than a muted tag.

| Token (`CONTEXT_COLORS`, `src/design/tokens.ts`) | Value     |
| ------------------------------------------------ | --------- |
| `purple`                                         | `#9275AC` |
| `teal`                                           | `#267D94` |
| `amber`                                          | `#8D6B31` |
| `rose`                                           | `#D791A1` |
| `slate`                                          | `#619CC6` |
| `sage`                                           | `#A1D09C` |
| `clay`                                           | `#C18B61` |
| `indigo`                                         | `#9CA2DE` |

- **Storage is always the token key** (e.g. `"purple"`), never a raw hex — `objects.color`/`tags.color` are checked at the database level to match that format, so the palette above can grow without a migration.
- **At launch, only `project`/`sub_project` may carry one** (a database `check`, easily relaxed). A Memory never stores its own colour: it derives one from its primary `about`-linked project (`src/domain/context-color.ts`).
- **Multiple contexts, one deterministic primary:** the `about` edge labelled `"primary"` wins; otherwise the oldest one does. Every other linked project is a _secondary_ context, shown as a small, muted indicator — colours are never blended (the design system has no gradient/soft-merge mechanism to blend them with).
- **This exact eight-colour set is provisional**, chosen by the same contrast/distinctness method as the object-type palette (chroma cap loosened, since these are meant to read as a real accent rather than a muted label) but explicitly open to revision in a dedicated design pass (ADR 0002 decision point 4) — it has no page of its own yet to preview it against.

## Component inventory

Every component implements the states listed (plus disabled/loading/empty/error where they apply).

**Atoms and readers**

| Component         | States                                       | Notes                                                           |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `ObjectChip`      | rest · hover · selected · stale · broken-ref | Type glyph + title. The atom of the product.                    |
| `MetricTile`      | rest · hover · loading · no-data · delta ±   | Tabular numerals; label above, delta below; optional sparkline. |
| `ProgressRail`    | actual · projected · target-marker · overrun | Solid sand = actual; hatched grey = projection.                 |
| `ConfidenceMeter` | high ≥75 · medium 45–74 · low <45 · unset    | Five ticks, not a percentage bar. On every estimate.            |
| `ScenarioSwitch`  | conservative · base · optimistic · dirty     | Global. Badges every affected view for recompute.               |
| `PeekPanel`       | closed · open · pinned · editing             | 440 px right sheet; same renderer as the full object page.      |
| `RelationList`    | grouped-by-verb · empty · add-mode           | Always grouped by edge verb, never a flat "linked items".       |

**Canvases and ambient surfaces**

| Component        | States                                                    | Notes                                                      |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `GraphCanvas`    | settling · settled · node-selected · path-mode · filtered | Force sim, drag-to-pin, two-hop dimming, legend-as-filter. |
| `GanttBoard`     | year · quarter · dependency-hover · slip-ghost            | Today line always visible; milestones as diamonds.         |
| `MapCanvas`      | idle · pin-hover · district-selected · overlay-on         | Zoom-gated labels, typed pins.                             |
| `RiskMatrix`     | 5×5 · cell-hover · cluster-count                          | Probability × impact.                                      |
| `CommandPalette` | recent · typing · grouped-results · action-mode · empty   | Search and create share one input.                         |
| `AIThread`       | idle · thinking · cited-answer · no-grounding             | Inline object chips; ungrounded claims refused.            |

**Implemented in Phase 4:** `ObjectChip`, `MetricTile`, `ProgressRail`, `ConfidenceMeter`, `ScenarioSwitch`, `PeekPanel` (+ `ObjectView`), `RelationList`, `RiskMatrix`, `CommandPalette`, `AIThread`, `StatusBadge`, `Panel`, `EmptyState`, `LoadingState`, `ErrorState`, `TypeGlyph`, `Icon`, `Sidebar`, `TopBar`, `Shell`. Canvas **contracts** (real states, static data; no physics, basemap or full scheduling yet): `GraphCanvas`, `GanttBoard`, `MapCanvas`.

**Additional components required by the prompt** (built in the phase that needs them): `ProjectCard`, `ProjectList`, `ProjectBoard`, `ProjectHeader`, `StatusBadge`, `EstimateCard`, `TimelineItem`, `GraphNode`, `MapMarker`, `RiskBadge`, `DecisionCard`, `NoteEditor`, `DocumentCard`, `Sidebar`, `Modal`, `Drawer`, `DataTable`, `EmptyState`, `LoadingState`, `ErrorState`.

## Shell

`248 px sidebar` (collapses to 56 px, icons + hover labels) · `56 px top bar` (scenario switch + search) · content region · optional `440 px` peek panel. Sidebar is flat (Lenses / Collections / Ambient) — never a tree.

## Responsive

Desktop is the primary workspace. Tablet stays usable; mobile stays functional. Canvases get dedicated behaviour rather than shrinking:

| Surface  | Mobile          |
| -------- | --------------- |
| Graph    | Radial ego-view |
| Map      | List-first      |
| Timeline | Vertical agenda |

## Accessibility

Keyboard-reachable everything (⌘/Ctrl+K, Space to peek, Enter to open); visible focus rings; no meaning by colour alone; `prefers-reduced-motion` respected (the graph settles instantly); AA contrast minimum; every canvas has a list/table equivalent.

## Implementation notes (Phase 4)

**Tokens are enforced, not merely documented.** The default Tailwind palette, radii and shadows are reset in `globals.css`, so `bg-gray-500`, `rounded-xl` and `shadow-lg` do not compile. `tests/unit/design-rules.test.ts` additionally scans the source and fails on gradients, shadows, blur, stock palette names, hex literals outside `src/design`, off-scale spacing and off-scale radii.

**Shell.** Sidebar 248 px, collapsing to a 56 px icon rail with hover labels (auto below 1280 px, user-overridable, persisted); top bar 56 px; content; peek panel 440 px. Unbuilt collections are listed as _planned, Phase N_ and are not links. Below 768 px the sidebar is a drawer; below 1280 px the peek is a focus-trapped sheet, above it a docked panel that can be pinned.

**State lives in the URL where a link should reproduce it** (`?scenario=`, `?peek=`), and sidebar links carry those parameters, so switching lenses preserves selection. Per-viewer preferences (sidebar mode, pinned peek, recents) are in a small persisted store.

**Canvas responsive behaviour.** Graph: full canvas, radial ego-view of the selected node on mobile, legend collapses behind a button. Timeline: Gantt board, quarters on zoom, vertical agenda on mobile. Map: list synced to the viewport (list first on mobile). Every canvas has a text alternative.

**Honesty rules.** Derived values are labelled as computed and never stored; estimates carry their `dataKind` and a "not a confirmed figure" caveat unless actual; an unset confidence is drawn hollow (not "low"); "no data" is never rendered as 0%; the assistant renders an answer with no cited object as a refusal; the map draws a coordinate plane only, never invented coastlines or borders.

**Verification.** Component tests use jsdom and axe. `scripts/verify-ui.mjs` drives a real browser (installed Edge/Chrome via `playwright-core`) across desktop, tablet and mobile: screenshots, axe **with colour contrast**, horizontal-overflow and console-error checks. The gallery at `/design` (development only) shows every token and component state.
