import type { ActivityAction, AppSettings } from "@/domain/api-types";
import type { EdgeKind } from "@/domain/enums";
import type { CreateObjectInput } from "@/domain/schemas";

/** The shape of a seed: the objects, relations and activity a fixture workspace starts from. */

export interface SeedObject {
  key: string;
  input: CreateObjectInput;
}

export interface SeedEdge {
  kind: EdgeKind;
  from: string;
  to: string;
  label?: string;
  dependencyType?: "fs" | "ss" | "ff" | "sf";
  lagDays?: number;
}

export interface SeedActivity {
  key: string;
  action: ActivityAction;
  hoursAgo: number;
  diff?: Record<string, unknown>;
}

export interface Seed {
  today: string;
  objects: SeedObject[];
  edges: SeedEdge[];
  activity: SeedActivity[];
  settings: AppSettings;
  /** Files the development file store starts with (the bytes behind seeded documents). */
  files?: { path: string; mime: string; text: string }[];
}

/** A stable UUID for a seed key, so fixtures and tests refer to the same ids every run. */
export function seedId(key: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822507);
    h4 = Math.imul(h4 ^ c, 3266489909);
  }
  const hex = [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
  // RFC 4122 shape: version 4 nibble, variant 8..b.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A tiny, valid one-page PDF showing `lines` (ASCII only), with a correct cross-reference table. */
export function minimalPdf(lines: readonly string[]): string {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = [
    "BT /F1 14 Tf 56 760 Td 18 TL",
    ...lines.map((l, i) => `${i === 0 ? "" : "T* "}(${esc(l)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
