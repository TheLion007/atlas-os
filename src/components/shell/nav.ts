import type { ObjectType } from "@/domain/enums";
import type { MessageKey } from "@/i18n";
import type { IconName } from "../ui/Icon";

/**
 * The flat navigation of the blueprint: three registers, no trees. Lenses are four views of one
 * dataset; collections are typed tables; ambient tools are summoned, not navigated to.
 *
 * `ready: false` items are shown but not linked. They stay visible so the product's shape is
 * legible, and are labelled with the phase that delivers them, instead of linking to a 404.
 */
export type NavIcon = { icon: IconName } | { glyph: ObjectType };

export interface NavItem {
  id: string;
  /** Catalogue key; the label is translated where it is shown. */
  label: MessageKey;
  href: string;
  mark: NavIcon;
  ready: boolean;
  /** When not ready: the phase that delivers it. */
  phase?: number;
  /** Collections list one object type, and can create it. */
  collection?: ObjectType;
}

export const LENSES: readonly NavItem[] = [
  { id: "overview", label: "nav.overview", href: "/", mark: { icon: "overview" }, ready: true },
  { id: "map", label: "nav.map", href: "/map", mark: { icon: "map" }, ready: true },
  { id: "graph", label: "nav.graph", href: "/graph", mark: { icon: "graph" }, ready: true },
  {
    id: "timeline",
    label: "nav.timeline",
    href: "/timeline",
    mark: { icon: "timeline" },
    ready: true,
  },
  {
    id: "calendar",
    label: "nav.calendar",
    href: "/calendar",
    mark: { icon: "overview" },
    ready: true,
  },
  {
    id: "timer",
    label: "nav.timer",
    href: "/timer",
    mark: { icon: "overview" },
    ready: true,
  },
  {
    id: "history",
    label: "nav.history",
    href: "/history",
    mark: { icon: "history" },
    ready: true,
  },
  {
    id: "memory",
    label: "nav.memory",
    href: "/memory",
    mark: { glyph: "memory" },
    ready: true,
  },
];

export const COLLECTIONS: readonly NavItem[] = [
  {
    id: "plans",
    label: "nav.plans",
    href: "/plans",
    mark: { glyph: "plan" },
    ready: true,
    collection: "plan",
  },
  {
    id: "projects",
    label: "nav.projects",
    href: "/projects",
    mark: { glyph: "project" },
    ready: true,
    collection: "project",
  },
  {
    id: "tasks",
    label: "nav.tasks",
    href: "/tasks",
    mark: { glyph: "task" },
    ready: true,
    collection: "task",
  },
  {
    id: "finance",
    label: "nav.finance",
    href: "/finance",
    mark: { icon: "finance" },
    ready: true,
  },
  {
    id: "decisions",
    label: "nav.decisions",
    href: "/decisions",
    mark: { glyph: "decision" },
    ready: true,
    collection: "decision",
  },
  {
    id: "risks",
    label: "nav.risks",
    href: "/risks",
    mark: { glyph: "risk" },
    ready: true,
    collection: "risk",
  },
  {
    id: "notes",
    label: "nav.notes",
    href: "/notes",
    mark: { glyph: "note" },
    ready: true,
    collection: "note",
  },
  {
    id: "documents",
    label: "nav.vault",
    href: "/documents",
    mark: { glyph: "document" },
    ready: true,
  },
];

export const SETTINGS_ITEM: NavItem = {
  id: "settings",
  label: "nav.settings",
  href: "/settings",
  mark: { icon: "settings" },
  ready: true,
};

export const ALL_NAV: readonly NavItem[] = [...LENSES, ...COLLECTIONS, SETTINGS_ITEM];

/** URL parameters that survive a lens switch ("switching a lens preserves selection"). */
export const PERSISTENT_PARAMS = ["scenario", "peek"] as const;

/** `href` carrying the persistent parameters of `current`. */
export function hrefKeepingState(href: string, current: URLSearchParams): string {
  const keep = new URLSearchParams();
  for (const name of PERSISTENT_PARAMS) {
    const v = current.get(name);
    if (v) keep.set(name, v);
  }
  const qs = keep.toString();
  return qs ? `${href}?${qs}` : href;
}

/** Catalogue key for the top bar title of the current path, or `null` for the brand name. */
export function titleKeyForPath(pathname: string): MessageKey | null {
  const exact = ALL_NAV.find((n) => n.href === pathname);
  if (exact) return exact.label;
  if (pathname.startsWith("/objects/")) return "nav.object";
  return null;
}

export function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/"
    ? pathname === "/"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
