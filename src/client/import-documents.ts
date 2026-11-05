import type { ApiObjectWithRelations, NewRelation } from "@/domain/api-types";
import {
  CONTENT_TEXT_MAX,
  isPlainTextFile,
  titleFromFileName,
  type DocumentFormat,
} from "@/domain/documents";
import type { DocumentKind } from "@/domain/enums";
import type { AtlasDataSource } from "./data-source";

export interface ImportOptions {
  /** A project (or sub-project) the document belongs to. */
  projectId?: string | null;
  kind?: DocumentKind;
  tags?: string[];
  /** When the import happens (the data source's clock). */
  now: Date;
}

/**
 * Imports one file as a Document: stores the bytes, reads its text when the browser can do so
 * directly (plain text, Markdown, CSV — never pretending to have read a PDF or an image), then
 * creates the document object with its metadata and project relation through the ordinary,
 * validated object API. If the object cannot be created, the stored file is removed again, so
 * no orphan bytes are left behind.
 */
export async function importDocument(
  source: AtlasDataSource,
  file: File,
  opts: ImportOptions,
): Promise<ApiObjectWithRelations> {
  const stored = await source.uploadFile(file);
  let contentText: string | null = null;
  if (isPlainTextFile(stored.mime, file.name)) {
    try {
      contentText = (await file.text()).slice(0, CONTENT_TEXT_MAX);
    } catch {
      contentText = null; // unreadable text stays "not extracted", never an empty pretend value
    }
  }
  const relations: NewRelation[] = opts.projectId
    ? [{ kind: "references", direction: "out", other: opts.projectId }]
    : [];
  try {
    return await source.createObject(
      {
        type: "document",
        title: titleFromFileName(file.name),
        status: "active",
        tags: opts.tags ?? [],
        confidence: null,
        details: {
          mime: stored.mime,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          storagePath: stored.storagePath,
          originalName: file.name.slice(0, 300),
          uploadedAt: opts.now.toISOString(),
          source: "upload",
          kind: opts.kind ?? guessKind(file.name),
          contentText,
        },
      },
      relations,
    );
  } catch (e) {
    await source.deleteFile(stored.storagePath).catch(() => undefined);
    throw e;
  }
}

/**
 * A first guess at what a document is, from words in its file name only ("invoice", "facture",
 * "contract"…). It is a suggestion the person can change, not a classification.
 */
export function guessKind(name: string): DocumentKind {
  const n = name.toLowerCase();
  const has = (...words: string[]) => words.some((w) => n.includes(w));
  if (has("invoice", "facture", "rechnung")) return "invoice";
  if (has("receipt", "reçu", "recu", "ticket")) return "receipt";
  if (has("contract", "contrat", "agreement", "bail", "lease")) return "contract";
  if (has("statement", "relevé", "releve", "extrait")) return "statement";
  if (has("tax", "impot", "impôt", "precompte", "précompte", "fiscal")) return "tax";
  if (has("passport", "passeport", "identity", "identité", "visa")) return "identity";
  return "other";
}

export type { DocumentFormat };
