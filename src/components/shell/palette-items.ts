import type { ApiObject } from "@/domain/api-types";
import type { CreatableType } from "@/domain/creation";
import { SCENARIO_VARIANTS, type ScenarioVariant } from "@/domain/enums";
import { searchObjects } from "@/domain/search";
import type { Locale, TFunction } from "@/i18n";
import { LOCALES, LOCALE_NAME } from "@/i18n/core";
import { ARTIFACT_NAV } from "./artifact-nav";
import { LENSES, type NavIcon, type NavItem, COLLECTIONS } from "./nav";

/**
 * What the palette shows, as data. Building the list is pure, so the behaviour (recent when
 * empty, grouped results when typing, actions after `>`) is tested without rendering anything.
 */
export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  /** Under the label, muted. */
  hint?: string;
  /** The key that does it from anywhere (shown at the right). */
  key?: string;
  /** One of the design's own 24 px icon paths, drawn in the row's square. */
  path?: string;
  mark?: NavIcon;
  /** `alt` means "peek" (stay where you are); the plain way is to open the page. */
  run: (opts: { alt: boolean }) => void;
}

export type PaletteMode = "recent" | "typing" | "action-mode";

export interface PaletteActions {
  peek: (id: string) => void;
  open: (id: string) => void;
  go: (href: string) => void;
  setScenario: (s: ScenarioVariant) => void;
  toggleSidebar: () => void;
  openAssistant: () => void;
  toggleTheme: () => void;
  toggleTimer: () => void;
  /** Open the create dialog, optionally inside an object. */
  create: (type?: CreatableType, parent?: ApiObject) => void;
  setLocale: (locale: Locale) => void;
}

export interface BuildInput {
  query: string;
  nodes: readonly ApiObject[];
  recent: readonly string[];
  scenario: ScenarioVariant;
  locale: Locale;
  t: TFunction;
  /** The object currently in focus (peeked), so creation can happen inside it. */
  context?: ApiObject | null;
  actions: PaletteActions;
}

export const ACTION_PREFIX = ">";
const PER_GROUP = 6;

export function paletteMode(query: string): PaletteMode {
  if (query.trimStart().startsWith(ACTION_PREFIX)) return "action-mode";
  return query.trim() === "" ? "recent" : "typing";
}

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const matches = (label: string, needle: string): boolean =>
  needle === "" || fold(label).includes(fold(needle));

function actionItems(input: BuildInput): PaletteItem[] {
  const { actions, scenario, t, locale } = input;
  const group = t("palette.groupActions");
  const list: PaletteItem[] = SCENARIO_VARIANTS.filter((v) => v !== scenario).map((v) => ({
    id: `action:scenario:${v}`,
    group,
    label: t("palette.previewScenario", { name: t(`scenario.${v}`) }),
    hint: t("palette.hintScenario"),
    mark: { icon: "timeline" as const },
    run: () => actions.setScenario(v),
  }));
  for (const l of LOCALES.filter((x) => x !== locale)) {
    list.push({
      id: `action:locale:${l}`,
      group,
      label: t("palette.switchLanguage", { language: LOCALE_NAME[l] }),
      mark: { icon: "settings" },
      run: () => actions.setLocale(l),
    });
  }
  list.push(
    {
      id: "action:sidebar",
      group,
      label: t("palette.toggleSidebar"),
      mark: { icon: "menu" },
      run: actions.toggleSidebar,
    },
    {
      id: "action:assistant",
      group,
      label: t("palette.openAssistant"),
      hint: "⌘J",
      mark: { icon: "assistant" },
      run: actions.openAssistant,
    },
  );
  return list;
}

const PATH = {
  plus: "M12 5v14M5 12h14",
  task: "M4 5h16v14H4zM8 12l3 3 5-6",
  note: "M6 3h9l4 4v14H6zM15 3v4h4M9 13h6",
  spark:
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  play: "M8 5v14l11-7z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
} as const;

/** The quick actions of the design: new project, task, note, the assistant, the theme. */
function quickItems(query: string, input: BuildInput): PaletteItem[] {
  const { t, actions } = input;
  const group = t("palette.groupQuick");
  const all: PaletteItem[] = [
    {
      id: "quick:project",
      group,
      label: t("hm.quick.project"),
      hint: t("palette.hintNewProject"),
      key: "P",
      path: PATH.plus,
      run: () => actions.create("project"),
    },
    {
      id: "quick:task",
      group,
      label: t("hm.quick.task"),
      hint: t("palette.hintNewTask"),
      key: "N",
      path: PATH.task,
      run: () => actions.create("task"),
    },
    {
      id: "quick:note",
      group,
      label: t("hm.quick.note"),
      hint: t("palette.hintNewNote"),
      key: "Q",
      path: PATH.note,
      run: () => actions.create("note"),
    },
    {
      id: "quick:timer",
      group,
      label: t("tm.startTimer"),
      hint: t("palette.hintTimer"),
      key: "T",
      path: PATH.play,
      run: actions.toggleTimer,
    },
    {
      id: "quick:assistant",
      group,
      label: t("palette.openAssistant"),
      hint: t("palette.hintAssistant"),
      key: "Ctrl J",
      path: PATH.spark,
      run: actions.openAssistant,
    },
    {
      id: "quick:theme",
      group,
      label: t("palette.toggleTheme"),
      hint: t("palette.hintTheme"),
      key: "D",
      path: PATH.moon,
      run: actions.toggleTheme,
    },
  ];
  return all.filter((i) => matches(`${i.label} ${i.hint ?? ""} ${group}`, query.trim()));
}

/** "Go to": the ten places of the design (their number keys), then the app's other screens. */
function navItems(query: string, input: BuildInput, onlyFew = false): PaletteItem[] {
  const { t, actions } = input;
  const group = t("palette.groupGoTo");
  const design: PaletteItem[] = ARTIFACT_NAV.map((n) => ({
    id: `go:${n.id}`,
    group,
    label: t(n.label),
    key: n.key,
    path: n.icon,
    run: () => actions.go(n.href),
  }));
  const known = new Set(design.map((d) => d.id));
  const others: PaletteItem[] = [...LENSES, ...COLLECTIONS]
    .filter((n: NavItem) => n.ready && !known.has(`go:${n.id}`))
    .map((n) => ({
      id: `go:${n.id}`,
      group,
      label: t(n.label),
      mark: n.mark,
      run: () => actions.go(n.href),
    }));
  // The Vault is the Documents screen: it answers to either name.
  const alias = (n: PaletteItem) =>
    n.id === "go:documents" ? `${n.label} ${t("nav.documents")}` : n.label;
  const list = [...design, ...others].filter((n) => matches(alias(n), query.trim()));
  return onlyFew
    ? list.filter((n) => ["go:calendar", "go:graph", "go:history"].includes(n.id))
    : list;
}

/** Every live project, the way the design lists them. */
function projectItems(
  nodes: readonly ApiObject[],
  input: BuildInput,
  query: string,
): PaletteItem[] {
  const { t, actions } = input;
  const group = t("palette.groupProjects");
  return nodes
    .filter((n) => n.type === "project" && n.status !== "dropped")
    .map((n) => ({
      id: `project:${n.id}`,
      group,
      label: n.title,
      hint:
        typeof n.details?.targetDate === "string"
          ? t("hm.due", { date: n.details.targetDate })
          : undefined,
      mark: { glyph: "project" as const },
      run: ({ alt }: { alt: boolean }) => (alt ? actions.peek(n.id) : actions.open(n.id)),
    }))
    .filter((i) => matches(`${i.label} ${i.hint ?? ""}`, query.trim()));
}

function objectItem(node: ApiObject, group: string, input: BuildInput): PaletteItem {
  const { t, actions } = input;
  return {
    id: `object:${node.id}`,
    group,
    label: node.title,
    hint: t(`type.${node.type}`),
    mark: { glyph: node.type },
    run: ({ alt }) => (alt ? actions.peek(node.id) : actions.open(node.id)),
  };
}

export function buildPaletteItems(input: BuildInput): PaletteItem[] {
  const { query, nodes, recent, t } = input;
  const mode = paletteMode(query);

  if (mode === "action-mode") {
    const needle = query.trimStart().slice(ACTION_PREFIX.length).trim();
    return actionItems(input).filter((a) => matches(a.label, needle));
  }

  if (mode === "recent") {
    // The design's empty palette: quick actions, a few places, then your projects.
    void recent;
    return [
      ...quickItems("", input),
      ...navItems("", input, true),
      ...projectItems(nodes, input, ""),
    ];
  }

  // Typing: results grouped by type, best group first, then things to create and places to go.
  const hits = searchObjects(nodes, query, { limit: 100 });
  const groups = new Map<string, { best: number; items: PaletteItem[] }>();
  for (const { node, score } of hits) {
    const group = t(`types.${node.type}`);
    const g = groups.get(group) ?? { best: 0, items: [] };
    if (g.items.length < PER_GROUP) g.items.push(objectItem(node, group, input));
    g.best = Math.max(g.best, score);
    groups.set(group, g);
  }
  const ranked = [...groups.entries()]
    .sort((a, b) => b[1].best - a[1].best)
    .flatMap(([, g]) => g.items);
  return [...quickItems(query, input), ...ranked, ...navItems(query, input)];
}
