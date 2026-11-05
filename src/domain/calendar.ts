import type { ApiEdge, ApiObject } from "./api-types";
import { addDays } from "./dates";
import { weekdayOf } from "./history";
import { descendantsOf } from "./project-view";

/**
 * What the Calendar shows, derived from the shared graph: the dates other things already carry
 * (a task's due date, a milestone's date, a decision's deadline, a project's target) and the
 * `event` objects (reminders and appointments). Nothing is stored apart: moving an item in the
 * Calendar rewrites the date on the object itself.
 */

export type CalKind = "due" | "reminder";

export interface CalItem {
  id: string;
  type: ApiObject["type"];
  title: string;
  kind: CalKind;
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Local `HH:MM`, only for a reminder that has a time. */
  time: string | null;
  projectId: string | null;
  done: boolean;
}

const DATE_FIELD: Partial<Record<ApiObject["type"], string>> = {
  task: "due",
  milestone: "date",
  decision: "deadline",
  project: "targetDate",
  sub_project: "targetDate",
};

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day and time of an instant, for a machine `offsetMin` minutes ahead of UTC. */
export function localParts(iso: string, offsetMin: number): { day: string; time: string } {
  const d = new Date(new Date(iso).getTime() + offsetMin * 60_000);
  return {
    day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** The instant for a local day and time (the inverse of `localParts`). */
export function toInstant(day: string, time: string, offsetMin: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [h, min] = time.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, h, min) - offsetMin * 60_000).toISOString();
}

export function calendarItems(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  offsetMin: number,
): CalItem[] {
  const projectOf = new Map<string, string>();
  for (const p of nodes) {
    if (p.type !== "project") continue;
    for (const id of descendantsOf(p.id, edges)) projectOf.set(id, p.id);
  }
  const link = new Map<string, string>();
  for (const e of edges) {
    link.set(e.from, link.get(e.from) ?? e.to);
    link.set(e.to, link.get(e.to) ?? e.from);
  }
  const owner = (n: ApiObject): string | null =>
    projectOf.get(n.id) ??
    (n.type === "project" ? n.id : null) ??
    projectOf.get(link.get(n.id) ?? "") ??
    null;

  const items: CalItem[] = [];
  for (const n of nodes) {
    if (n.status === "dropped") continue;
    if (n.type === "event") {
      const at = n.details?.startsAt;
      if (typeof at !== "string") continue;
      const allDay = n.details?.allDay === true;
      const { day, time } = localParts(at, offsetMin);
      items.push({
        id: n.id,
        type: n.type,
        title: n.title,
        kind: "reminder",
        day,
        time: allDay ? null : time,
        projectId: owner(n),
        done: n.status === "done",
      });
      continue;
    }
    const field = DATE_FIELD[n.type];
    const day = field ? n.details?.[field] : undefined;
    if (!field || !isDay(day)) continue;
    items.push({
      id: n.id,
      type: n.type,
      title: n.title,
      kind: "due",
      day,
      time: null,
      projectId: owner(n),
      done: n.status === "done",
    });
  }
  return items.sort((a, b) =>
    a.day === b.day ? (a.time ?? "").localeCompare(b.time ?? "") : a.day < b.day ? -1 : 1,
  );
}

/**
 * The details to write so that `item` falls on `day` (and at `time`, for a reminder). Returns
 * the whole new `details` of the object, so a partial write cannot drop its other fields.
 */
export function rescheduledDetails(
  node: ApiObject,
  item: CalItem,
  day: string,
  time: string | null,
  offsetMin: number,
): Record<string, unknown> {
  const details = { ...(node.details ?? {}) };
  if (node.type === "event") {
    details.startsAt = toInstant(day, time ?? item.time ?? "09:00", offsetMin);
    return details;
  }
  const field = DATE_FIELD[node.type];
  if (field) details[field] = day;
  return details;
}

/** Weeks (Monday first) covering the month that contains `anchor`. */
export function monthWeeks(anchor: string): string[][] {
  const first = `${anchor.slice(0, 7)}-01`;
  const start = addDays(first, -weekdayOf(first));
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const last = addDays(`${y}-${pad(m)}-01`, new Date(Date.UTC(y, m, 0)).getUTCDate() - 1);
  const weeks: string[][] = [];
  for (let d = start; d <= last || weeks.length === 0; d = addDays(d, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}

export function weekOf(anchor: string): string[] {
  const start = addDays(anchor, -weekdayOf(anchor));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type CalView = "month" | "week" | "day";

/** The anchor one step before or after, in the unit of the view. */
export function stepAnchor(anchor: string, view: CalView, dir: 1 | -1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}
