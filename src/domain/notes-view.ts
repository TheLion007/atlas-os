import type { ApiEdge, ApiObject } from "./api-types";
import { descendantsOf } from "./project-view";

export type BlockType = "heading" | "paragraph" | "list" | "todo" | "quote" | "code";

export interface NoteBlock {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
}

/** The blocks of a note, read defensively from its free-form details. */
export function noteBlocks(note: ApiObject): NoteBlock[] {
  const raw = note.details?.blocks;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b, i) => {
    if (typeof b !== "object" || b === null) return [];
    const r = b as Record<string, unknown>;
    const type = (["heading", "paragraph", "list", "todo", "quote", "code"] as const).find(
      (t) => t === r.type,
    );
    return [
      {
        id: typeof r.id === "string" ? r.id : String(i + 1),
        type: type ?? "paragraph",
        text: typeof r.text === "string" ? r.text : "",
        ...(typeof r.checked === "boolean" ? { checked: r.checked } : {}),
      },
    ];
  });
}

/** The line shown under a note's title in the list: its first piece of plain text. */
export function noteExcerpt(blocks: readonly NoteBlock[]): string {
  const first = blocks.find((b) => b.type !== "heading" && b.type !== "code" && b.text.trim());
  const text = (first ?? blocks.find((b) => b.text.trim()))?.text.trim() ?? "";
  return text.replace(/\s+/g, " ");
}

/** The note in three sentences at most: no model, the first sentences of its prose. */
export function summarizeNote(blocks: readonly NoteBlock[]): string {
  const sentences = blocks
    .filter((b) => b.type !== "code" && b.type !== "heading" && b.text.trim())
    .flatMap((b) => b.text.trim().match(/[^.!?…]+[.!?…]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const lines = sentences.slice(0, 3);
  if (lines.length > 0) return lines.join(" ");
  return blocks
    .map((b) => b.text.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
}

export interface NoteRow {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
}

export interface NoteGroup {
  /** `null` for the global notes, otherwise the project's id. */
  projectId: string | null;
  label: string;
  color: string | null;
  notes: NoteRow[];
}

/** The project a note belongs to: the one it points at, directly or through a task or sub-project. */
export function projectOfNote(
  note: ApiObject,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): ApiObject | null {
  const projects = nodes.filter((n) => n.type === "project");
  const own = edges.filter(
    (e) => e.from === note.id || (e.kind === "contains" && e.to === note.id),
  );
  for (const e of own) {
    const other = e.from === note.id ? e.to : e.from;
    const direct = projects.find((p) => p.id === other);
    if (direct) return direct;
  }
  for (const e of own) {
    const other = e.from === note.id ? e.to : e.from;
    for (const p of projects) if (descendantsOf(p.id, edges).has(other)) return p;
  }
  return null;
}

/** Notes grouped the way the design lists them: global first, then one group per project. */
export function groupNotes(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  query: string,
  globalLabel: string,
): NoteGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string | null, NoteGroup>();
  const notes = nodes
    .filter((n) => n.type === "note" && n.status !== "dropped")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  for (const n of notes) {
    const blocks = noteBlocks(n);
    const hay = `${n.title} ${blocks.map((b) => b.text).join(" ")}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    const p = projectOfNote(n, nodes, edges);
    const key = p?.id ?? null;
    let g = groups.get(key);
    if (!g) {
      g = { projectId: key, label: p?.title ?? globalLabel, color: p?.color ?? null, notes: [] };
      groups.set(key, g);
    }
    g.notes.push({
      id: n.id,
      title: n.title,
      excerpt: noteExcerpt(blocks),
      updatedAt: n.updatedAt,
    });
  }
  return [...groups.values()].sort((a, b) =>
    a.projectId === null ? -1 : b.projectId === null ? 1 : a.label.localeCompare(b.label),
  );
}

export interface NoteLink {
  id: string;
  type: ApiObject["type"];
  title: string;
}

/** What the note points at, and which other notes point at it. */
export function noteLinks(
  note: ApiObject,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): { out: NoteLink[]; back: NoteLink[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const link = (id: string): NoteLink[] => {
    const n = byId.get(id);
    return n ? [{ id: n.id, type: n.type, title: n.title }] : [];
  };
  return {
    out: edges.filter((e) => e.from === note.id).flatMap((e) => link(e.to)),
    back: edges
      .filter((e) => e.to === note.id && byId.get(e.from)?.type === "note")
      .flatMap((e) => link(e.from)),
  };
}
