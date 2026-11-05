import type { MessageKey } from "@/i18n";

/**
 * THE sidebar of the design (the Claude Design artifact is the visual reference): exactly these
 * ten entries, in this order, with these icons and these number shortcuts (1 to 9, then 0).
 * Nothing else belongs in the sidebar; the app's other screens are reached from the command
 * palette and from "Other views" in Settings. A test pins this list.
 */
export interface ArtifactNavItem {
  /** The id the rest of the shell knows the place by (mascot lines, titles). */
  id: string;
  label: MessageKey;
  href: string;
  /** The artifact's own 24 px icon path. */
  icon: string;
  /** The key that goes there: 1 to 9, then 0. */
  key: string;
}

export const ARTIFACT_NAV: readonly ArtifactNavItem[] = [
  { id: "overview", label: "nav.home", href: "/", icon: "M4 11l8-7 8 7v9h-5v-6H9v6H4z", key: "1" },
  {
    id: "projects",
    label: "nav.projects",
    href: "/projects",
    icon: "M4 5h7v7H4zM13 5h7v14h-7zM4 14h7v5H4z",
    key: "2",
  },
  {
    id: "calendar",
    label: "nav.calendar",
    href: "/calendar",
    icon: "M4 6h16v14H4zM4 10h16M9 3v5M15 3v5",
    key: "3",
  },
  {
    id: "graph",
    label: "nav.graph",
    href: "/graph",
    icon: "M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M18 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M10 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M7 8.5l2 7M8.5 6.5l7 1M16.5 10l-5 6",
    key: "4",
  },
  {
    id: "map",
    label: "nav.map",
    href: "/map",
    icon: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
    key: "5",
  },
  {
    id: "documents",
    label: "nav.vault",
    href: "/documents",
    icon: "M4 5h16v14H4zM4 9h16M10 13h4",
    key: "6",
  },
  {
    id: "timer",
    label: "nav.timer",
    href: "/timer",
    icon: "M12 13m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M12 13V9.5M9.5 3h5",
    key: "7",
  },
  {
    id: "notes",
    label: "nav.notes",
    href: "/notes",
    icon: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5",
    key: "8",
  },
  {
    id: "history",
    label: "nav.history",
    href: "/history",
    icon: "M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM10 10h4v4h-4zM4 16h4v4H4z",
    key: "9",
  },
  {
    id: "settings",
    label: "nav.settings",
    href: "/settings",
    icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
    key: "0",
  },
];
