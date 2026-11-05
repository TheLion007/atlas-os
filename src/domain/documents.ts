import type { ApiEdge, ApiObject } from "./api-types";
import type { ChipRef } from "./command-center";
import type { DocumentKind, ObjectType } from "./enums";
import { visibleTags } from "./creation";

/**
 * The Document library's view-model, derived from the shared object graph like Memory Storage:
 * one `document` object per file (its metadata), related to everything else through ordinary
 * edges. Nothing here is a second store. The file itself lives in the file store, addressed by
 * `storagePath`; its format is derived from the mime type, never stored twice.
 */

export type DocumentFormat =
  | "pdf"
  | "image"
  | "text"
  | "spreadsheet"
  | "presentation"
  | "word"
  | "archive"
  | "audio"
  | "video"
  | "other";

export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
  "pdf",
  "image",
  "text",
  "word",
  "spreadsheet",
  "presentation",
  "archive",
  "audio",
  "video",
  "other",
];

const EXTENSION_FORMAT: Record<string, DocumentFormat> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  svg: "image",
  txt: "text",
  md: "text",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  json: "text",
  xml: "text",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  ods: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  key: "presentation",
  zip: "archive",
  gz: "archive",
  "7z": "archive",
  rar: "archive",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
};

/** The format family of a file, from its mime type, falling back to its extension. */
export function documentFormat(mime: string, name?: string | null): DocumentFormat {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.includes("spreadsheet") || m.includes("excel") || m === "text/csv") return "spreadsheet";
  if (m.includes("presentation") || m.includes("powerpoint")) return "presentation";
  if (m.includes("wordprocessing") || m === "application/msword" || m.includes("opendocument.text"))
    return "word";
  if (m.includes("zip") || m.includes("compressed") || m.includes("tar")) return "archive";
  if (m.startsWith("text/") || m === "application/json" || m === "application/xml") return "text";
  const ext = name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && EXTENSION_FORMAT[ext]) || "other";
}

/** How the preview shows a document: natively, as text, or not at all (download instead). */
export type PreviewKind = "pdf" | "image" | "text" | "none";

export function previewKind(format: DocumentFormat, mime: string): PreviewKind {
  if (format === "pdf") return "pdf";
  // SVG can carry script: it is shown as a download, never inlined.
  if (format === "image" && mime !== "image/svg+xml") return "image";
  if (format === "text") return "text";
  return "none";
}

/** Formats whose text can be read directly in the browser, with no OCR or parser. */
export function isPlainTextFile(mime: string, name?: string | null): boolean {
  const f = documentFormat(mime, name);
  if (f === "text") return true;
  return mime === "text/csv" || /\.(csv|tsv|md|txt)$/i.test(name ?? "");
}

/** Upper bound on one stored file, enforced by the client and the server alike. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Where a new file is stored: a fresh id, then a safe version of its name. */
export function storagePathFor(id: string, name: string): string {
  const safe = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-120);
  return `files/${id}/${safe || "file"}`;
}

/** Extracted text is capped: it is a search aid, not a copy of the file. */
export const CONTENT_TEXT_MAX = 200_000;

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  title: string;
  kind: DocumentKind;
  format: DocumentFormat;
  mime: string;
  sizeBytes: number;
  description: string;
  source: string;
  issuer: string | null;
  validUntil: string | null;
  originalName: string | null;
  storagePath: string | null;
  /** Whether the file itself is stored (a document can be recorded without its file). */
  hasFile: boolean;
  /** Whether its content is searchable (text was extracted). */
  contentIndexed: boolean;
  status: ApiObject["status"];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
  projects: ChipRef[];
  memories: ChipRef[];
  finance: ChipRef[];
  other: ChipRef[];
}

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};

const PROJECTISH: readonly ObjectType[] = ["project", "sub_project"];
const FINANCIAL: readonly ObjectType[] = ["estimate", "transaction", "property"];

export function buildDocumentRows(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): DocumentRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const related = new Map<string, Map<string, ChipRef>>();
  for (const e of edges) {
    for (const [self, otherId] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      const me = byId.get(self);
      const other = byId.get(otherId);
      if (me?.type !== "document" || !other) continue;
      const m = related.get(self) ?? new Map<string, ChipRef>();
      m.set(other.id, { id: other.id, type: other.type, title: other.title });
      related.set(self, m);
    }
  }
  const rows: DocumentRow[] = [];
  for (const n of nodes) {
    if (n.type !== "document") continue;
    const d = n.details;
    const mime = str(d, "mime") ?? "application/octet-stream";
    const originalName = str(d, "originalName");
    const format = documentFormat(mime, originalName ?? n.title);
    const links = [...(related.get(n.id)?.values() ?? [])];
    rows.push({
      id: n.id,
      title: n.title,
      kind: (str(d, "kind") ?? "other") as DocumentKind,
      format,
      mime,
      sizeBytes: typeof d?.sizeBytes === "number" ? d.sizeBytes : 0,
      description: str(d, "description") ?? "",
      source: str(d, "source") ?? "",
      issuer: str(d, "issuer"),
      validUntil: str(d, "validUntil"),
      originalName,
      storagePath: str(d, "storagePath"),
      hasFile: str(d, "storagePath") !== null,
      contentIndexed: typeof d?.contentText === "string",
      status: n.status,
      tags: visibleTags(n.tags),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      uploadedAt: str(d, "uploadedAt"),
      projects: links.filter((c) => PROJECTISH.includes(c.type)),
      memories: links.filter((c) => c.type === "memory"),
      finance: links.filter((c) => FINANCIAL.includes(c.type)),
      other: links.filter(
        (c) => !PROJECTISH.includes(c.type) && c.type !== "memory" && !FINANCIAL.includes(c.type),
      ),
    });
  }
  return rows;
}

// ── Filtering & sorting ──────────────────────────────────────────────────────────────────────

export interface DocumentFilters {
  query: string;
  /** A project/sub-project id, `"all"`, or `"none"` for documents in no project. */
  projectId: string | "all" | "none";
  kind: DocumentKind | "all";
  format: DocumentFormat | "all";
  /** "active" hides archived (dropped) documents. */
  status: "active" | "all";
}

export const DEFAULT_DOCUMENT_FILTERS: DocumentFilters = {
  query: "",
  projectId: "all",
  kind: "all",
  format: "all",
  status: "active",
};

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Where a query matched, so the library can say "found in the content" when the name alone
 * does not explain the hit. `content` only exists for documents whose text was extracted.
 */
export type DocumentMatch = "title" | "metadata" | "content";

/**
 * Matches every word of the query against the name, the metadata (kind, format, tags, projects,
 * description, issuer, original file name) and — only where text was extracted — the content.
 */
export function matchDocument(
  row: DocumentRow,
  query: string,
  contentText: string | null,
  labels: { kind?: string; format?: string } = {},
): DocumentMatch | null {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "title";
  const title = fold(row.title);
  const meta = fold(
    [
      row.kind,
      labels.kind,
      row.format,
      labels.format,
      row.mime,
      row.description,
      row.issuer,
      row.originalName,
      row.source,
      ...row.tags,
      ...row.projects.map((p) => p.title),
      ...row.memories.map((m) => m.title),
      ...row.finance.map((f) => f.title),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const content = contentText ? fold(contentText) : "";
  let where: DocumentMatch = "title";
  for (const t of tokens) {
    if (title.includes(t)) continue;
    if (meta.includes(t)) {
      if (where === "title") where = "metadata";
      continue;
    }
    if (content.includes(t)) {
      where = "content";
      continue;
    }
    return null;
  }
  return where;
}

export function filterDocumentRows(
  rows: readonly DocumentRow[],
  filters: DocumentFilters,
  contentOf: (id: string) => string | null = () => null,
): DocumentRow[] {
  return rows.filter((r) => {
    if (filters.status === "active" && r.status === "dropped") return false;
    if (filters.kind !== "all" && r.kind !== filters.kind) return false;
    if (filters.format !== "all" && r.format !== filters.format) return false;
    if (filters.projectId === "none" && r.projects.length > 0) return false;
    if (
      filters.projectId !== "all" &&
      filters.projectId !== "none" &&
      !r.projects.some((p) => p.id === filters.projectId)
    )
      return false;
    return matchDocument(r, filters.query, contentOf(r.id)) !== null;
  });
}

export type DocumentSort = "updated" | "created" | "name" | "size";

export function sortDocumentRows(rows: readonly DocumentRow[], sort: DocumentSort): DocumentRow[] {
  const copy = [...rows];
  switch (sort) {
    case "created":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "name":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "size":
      return copy.sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title));
    case "updated":
    default:
      return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

/** A title for an imported file: its name without the extension, tidied. */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]{1,6}$/i, "")
    .replace(/[_]+/g, " ")
    .trim();
  return (base || name).slice(0, 200);
}
