"use client";

import { useSelectedObject } from "@/lib/deletion-store";
import { DeleteButton } from "../shell/DeleteButton";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type DragEvent } from "react";
import {
  describeError,
  describeWriteError,
  useGraph,
  useImportDocuments,
  useObject,
} from "@/client/hooks";
import { guessKind } from "@/client/import-documents";
import {
  buildDocumentRows,
  DEFAULT_DOCUMENT_FILTERS,
  filterDocumentRows,
  matchDocument,
  MAX_FILE_BYTES,
  sortDocumentRows,
  type DocumentFilters,
  type DocumentFormat,
  type DocumentRow,
} from "@/domain/documents";
import { DOCUMENT_KINDS, type DocumentKind } from "@/domain/enums";
import { projectColor } from "@/design/palette";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { playSound } from "@/lib/feedback/sound";
import { selectClass } from "../finance/bits";
import { formatBytes } from "../shell/object-fields";
import { DocumentPreview } from "../shell/object-extras";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

interface Pending {
  file: File;
  kind: DocumentKind;
}

const BADGE: Record<DocumentFormat, string> = {
  pdf: "bg-critical",
  image: "bg-accent",
  word: "bg-accent",
  spreadsheet: "bg-positive",
  text: "bg-fg",
  presentation: "bg-warn",
  archive: "bg-fg-muted",
  audio: "bg-fg-muted",
  video: "bg-fg-muted",
  other: "bg-fg-subtle",
};

/** "PDF", "PNG", "XLSX": the file's own extension, or its format family. */
function extOf(r: DocumentRow): string {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(r.originalName ?? r.title);
  return (m?.[1] ?? r.format).toUpperCase().slice(0, 4);
}

const primary =
  "inline-flex h-9 items-center gap-2 rounded-[11px] bg-fg px-4 text-[13px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96]";

/**
 * The Vault, as in the design: folders on the left (a project and the kinds of paper in it), a
 * drop zone and the list of files in the middle, the selected file and its linked tasks on the
 * right. A document is still one object of the shared graph; its bytes live in the file store,
 * and nothing here pretends to have read a file it has not.
 */
export function DocumentsLens() {
  const { t, f } = useI18n();
  const graph = useGraph();
  const params = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const pushToast = useUi((s) => s.pushToast);
  const importer = useImportDocuments();
  const [filters, setFilters] = useState<DocumentFilters>(DEFAULT_DOCUMENT_FILTERS);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [importTags, setImportTags] = useState("");
  const [dragging, setDragging] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);
  const all = useMemo(() => buildDocumentRows(nodes, edges), [nodes, edges]);
  const contentOf = useMemo(() => {
    const m = new Map(
      nodes
        .filter((n) => n.type === "document" && typeof n.details?.contentText === "string")
        .map((n) => [n.id, n.details?.contentText as string]),
    );
    return (id: string) => m.get(id) ?? null;
  }, [nodes]);
  const rows = useMemo(
    () =>
      sortDocumentRows(
        filterDocumentRows(all, { ...filters, status: "active" }, contentOf),
        "updated",
      ),
    [all, filters, contentOf],
  );
  const projects = useMemo(
    () => nodes.filter((n) => n.type === "project").sort((a, b) => a.title.localeCompare(b.title)),
    [nodes],
  );
  const selected = rows.find((r) => r.id === chosen) ?? rows[0] ?? null;
  const detail = useObject(selected?.id ?? null);
  useSelectedObject(selected?.id);

  if (graph.isPending) return <LoadingState label={t("cf.title")} lines={6} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const live = all.filter((r) => r.status !== "dropped");
  const inProject = (id: string) => live.filter((r) => r.projects.some((p) => p.id === id));
  const orphans = live.filter((r) => r.projects.length === 0);
  const importProject =
    filters.projectId !== "all" && filters.projectId !== "none" ? filters.projectId : "";

  const choose = (list: FileList | File[] | null) => {
    if (!list) return;
    const files = [...list];
    const tooBig = files.filter((file) => file.size > MAX_FILE_BYTES);
    setFailures(tooBig.map((file) => t("documents.import.tooBig", { name: file.name })));
    setPending((p) => [
      ...p,
      ...files
        .filter((file) => file.size <= MAX_FILE_BYTES)
        .map((file) => ({
          file,
          kind: filters.kind !== "all" ? filters.kind : guessKind(file.name),
        })),
    ]);
  };

  const runImport = async () => {
    if (pending.length === 0) return;
    const tags = importTags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const results: { name: string; id?: string; error?: unknown }[] = [];
    // Kinds may differ per file, so each file is its own import call.
    for (const p of pending) {
      const [r] = await importer.mutateAsync({
        files: [p.file],
        projectId: importProject || null,
        kind: p.kind,
        tags,
      });
      if (r) results.push(r);
    }
    const ok = results.filter((r) => r.id);
    const bad = results.filter((r) => r.error);
    setFailures(bad.map((r) => `${r.name}: ${describeWriteError(r.error, t)}`));
    setPending([]);
    if (ok.length > 0) {
      playSound("create");
      pushToast(t("documents.import.done", { count: ok.length }));
      if (ok[0]?.id) setChosen(ok[0].id);
    }
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget === e.target) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      choose(e.dataTransfer.files);
    },
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        choose(e.target.files);
        e.target.value = "";
      }}
    />
  );
  const pick = () => {
    playSound("click");
    input.current?.click();
  };

  const header = (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h2 className="font-display text-[30px] leading-none font-extrabold tracking-[-0.03em]">
          {t("cf.title")}
        </h2>
        <span className="text-[13px] text-fg-subtle">{t("cf.sub")}</span>
      </div>
      <label className="flex h-9 w-[260px] max-w-full items-center gap-2 rounded-[11px] border border-border bg-surface px-3">
        <Icon name="search" className="shrink-0 text-fg-subtle" />
        <span className="sr-only">{t("documents.searchPlaceholder")}</span>
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
          placeholder={t("documents.searchPlaceholder")}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none! placeholder:text-fg-subtle"
        />
      </label>
      <button type="button" onClick={pick} className={primary}>
        <Icon name="upload" />
        {t("cf.add")}
      </button>
    </div>
  );

  const importPanel = pending.length > 0 && (
    <section
      aria-labelledby="doc-import"
      className="flex flex-col gap-3 rounded-[16px] border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="doc-import" className="text-[13.5px] font-semibold">
          {t("documents.import.ready", { count: pending.length })}
        </h3>
        <button
          type="button"
          onClick={() => setPending([])}
          className="text-[12.5px] text-fg-muted hover:text-fg"
        >
          {t("common.cancel")}
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {pending.map((p, i) => (
          <li key={`${p.file.name}-${i}`} className="flex flex-wrap items-center gap-3 text-[13px]">
            <span className="min-w-0 grow truncate">{p.file.name}</span>
            <span className="num text-[11px] text-fg-subtle">
              {formatBytes(p.file.size, { f })}
            </span>
            <label className="sr-only" htmlFor={`doc-kind-${i}`}>
              {t("form.documentKind")}
            </label>
            <select
              id={`doc-kind-${i}`}
              className={selectClass}
              value={p.kind}
              onChange={(e) =>
                setPending((all) =>
                  all.map((x, j) => (j === i ? { ...x, kind: e.target.value as DocumentKind } : x)),
                )
              }
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`documentKind.${k}`)}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={t("documents.import.remove", { name: p.file.name })}
              onClick={() => setPending((all) => all.filter((_, j) => j !== i))}
              className="inline-flex size-8 items-center justify-center rounded-[10px] text-fg-muted hover:bg-sunk hover:text-fg"
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1 text-[12.5px]">
        <span className="text-fg-muted">{t("form.tags")}</span>
        <input
          type="text"
          value={importTags}
          onChange={(e) => setImportTags(e.target.value)}
          placeholder={t("form.tagsHint")}
          className="h-9 rounded-[11px] border border-border-strong bg-surface px-3 text-[13px] outline-none! focus-visible:border-accent"
        />
      </label>
      <p className="text-[11.5px] text-fg-subtle">{t("documents.import.contentNote")}</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={importer.isPending}
          className={cn(primary, "disabled:opacity-60")}
        >
          <Icon name="upload" />
          {importer.isPending
            ? t("documents.import.working")
            : t("documents.import.go", { count: pending.length })}
        </button>
      </div>
    </section>
  );

  const failureList = failures.length > 0 && (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-[12px] border border-border p-3 text-sm"
    >
      {failures.map((msg) => (
        <p key={msg} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-2 inline-block size-2 shrink-0 rounded-full bg-critical"
          />
          {msg}
        </p>
      ))}
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <div
      className="relative mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9"
      {...dropProps}
    >
      {fileInput}
      {header}
      {importPanel}
      {failureList}
      {children}
    </div>
  );

  if (all.length === 0)
    return shell(
      <div
        className={cn(
          "rounded-[20px] border border-dashed p-2",
          dragging ? "border-accent" : "border-border-strong",
        )}
      >
        <EmptyState
          title={t("documents.empty.title")}
          description={t("documents.empty.body")}
          action={
            <button type="button" onClick={pick} className={primary}>
              <Icon name="upload" />
              {t("documents.import")}
            </button>
          }
        />
      </div>,
    );

  const q = filters.query.trim();
  const matchOf = (r: DocumentRow) =>
    q
      ? matchDocument(r, q, contentOf(r.id), {
          kind: t(`documentKind.${r.kind}`),
          format: t(`documents.format.${r.format}` as never),
        })
      : null;
  const folder = (
    label: string,
    count: number,
    on: boolean,
    go: () => void,
    opts?: { sub?: boolean; color?: string },
  ) => (
    <button
      key={label + String(opts?.sub)}
      type="button"
      onClick={() => {
        playSound("click");
        go();
      }}
      aria-current={on ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-[10px] py-2 text-left text-[13px] transition-[background-color,transform] duration-200 hover:translate-x-[2px]",
        opts?.sub ? "pr-2 pl-7 text-fg-muted" : "px-2 font-semibold",
        on ? "bg-surface text-fg shadow-card" : "hover:bg-surface/60",
      )}
    >
      {opts?.color && <i className="size-2 rounded-[3px]" style={{ background: opts.color }} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="num text-[11px] text-fg-subtle">{count}</span>
    </button>
  );
  const { projectId, kind } = filters;
  const setFolder = (p: string, k: DocumentKind | "all" = "all") =>
    setFilters((x) => ({ ...x, projectId: p, kind: k }));

  return shell(
    <div className="flex flex-wrap items-start gap-[22px]">
      {/* Folders */}
      <nav
        aria-label={t("cf.folders")}
        className="flex w-full flex-none flex-col gap-[2px] rounded-[18px] bg-sunk p-3 md:w-[250px]"
      >
        {folder(t("cf.all"), live.length, projectId === "all" && kind === "all", () =>
          setFolder("all"),
        )}
        {projects.map((p) => {
          const mine = inProject(p.id);
          if (mine.length === 0) return null;
          const kinds = DOCUMENT_KINDS.filter((k) => mine.some((r) => r.kind === k));
          return (
            <div key={p.id} className="flex flex-col gap-[2px]">
              {folder(
                p.title,
                mine.length,
                projectId === p.id && kind === "all",
                () => setFolder(p.id),
                {
                  color: projectColor(p.color, p.id),
                },
              )}
              {kinds.map((k) =>
                folder(
                  t(`documentKind.${k}`),
                  mine.filter((r) => r.kind === k).length,
                  projectId === p.id && kind === k,
                  () => setFolder(p.id, k),
                  { sub: true },
                ),
              )}
            </div>
          );
        })}
        {orphans.length > 0 &&
          folder(t("cf.noProject"), orphans.length, projectId === "none", () => setFolder("none"))}
      </nav>

      {/* Drop zone and list */}
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
        <button
          type="button"
          onClick={pick}
          className={cn(
            "flex items-center gap-4 rounded-[18px] border border-dashed bg-transparent px-5 py-4 text-left transition-colors duration-200",
            dragging ? "border-accent bg-accent-soft" : "border-border-strong hover:bg-surface/60",
          )}
        >
          <span className="grid size-9 flex-none place-items-center rounded-[11px] bg-surface text-accent-ink shadow-card">
            <Icon name="upload" />
          </span>
          <span className="flex flex-col gap-px">
            <span className="text-[13.5px] font-semibold">
              {dragging ? t("cf.dropActive") : t("cf.drop")}
            </span>
            <span className="text-[12px] text-fg-subtle">{t("cf.dropSub")}</span>
          </span>
        </button>

        <div className="overflow-hidden rounded-[20px] border border-border bg-surface shadow-card">
          <div className="num flex items-center justify-between border-b border-border px-4 py-3 text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
            <span>{t("documents.count", { count: rows.length })}</span>
            <span>{t("cf.modified")}</span>
          </div>
          {rows.length === 0 && (
            <p role="status" className="px-4 py-6 text-[13px] text-fg-subtle">
              {q ? t("documents.filtered") : t("cf.nothing")}
            </p>
          )}
          <ul>
            {rows.map((r) => {
              const on = selected?.id === r.id;
              const place = [r.projects[0]?.title, t(`documentKind.${r.kind}`)]
                .filter(Boolean)
                .join(" › ");
              return (
                <li key={r.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    data-object-id={r.id}
                    onClick={() => {
                      playSound("click");
                      setChosen(r.id);
                    }}
                    aria-current={on ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-200",
                      on ? "bg-accent-soft" : "hover:bg-hover",
                    )}
                  >
                    <span
                      className={cn(
                        "num grid size-[34px] flex-none place-items-center rounded-[9px] text-[9.5px] font-bold text-on-accent",
                        BADGE[r.format],
                      )}
                    >
                      {extOf(r)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                      <span className="truncate text-[13.5px] font-semibold">{r.title}</span>
                      <span className="flex flex-wrap items-center gap-[6px] text-[11.5px] text-fg-subtle">
                        <span>{place}</span>
                        <span className="rounded-[6px] bg-sunk px-[6px] py-px text-fg-muted">
                          {t(`documentKind.${r.kind}`)}
                        </span>
                        {r.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-[6px] bg-sunk px-[6px] py-px text-fg-muted"
                          >
                            {tag}
                          </span>
                        ))}
                        {r.memories.length > 0 && (
                          <span>{t("documents.links.memories", { count: r.memories.length })}</span>
                        )}
                        {r.finance.length > 0 && (
                          <span>{t("documents.links.finance", { count: r.finance.length })}</span>
                        )}
                        {matchOf(r) === "content" && (
                          <span className="text-accent-ink">{t("documents.foundInContent")}</span>
                        )}
                      </span>
                    </span>
                    <span className="num flex flex-none flex-col items-end gap-[3px] text-[11px] text-fg-subtle">
                      <span>{f.date(r.updatedAt.slice(0, 10))}</span>
                      <span>
                        {r.hasFile ? formatBytes(r.sizeBytes, { f }) : t("documents.noFile")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <button
          type="button"
          onClick={() => openCreate({ type: "document" })}
          className="self-start text-[12px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
        >
          {t("documents.record")}
        </button>
      </div>

      {/* The selected file */}
      <aside className="flex min-w-[260px] flex-[0_1_330px] flex-col gap-4">
        {selected ? (
          <>
            <div className="rounded-[20px] bg-sunk p-4">
              {detail.data ? (
                <DocumentPreview object={detail.data} variant="panel" />
              ) : (
                <p className="text-[13px] text-fg-subtle">{t("cf.choose")}</p>
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-[18px] shadow-card">
              <div className="flex flex-col gap-1">
                <h3 className="text-[14.5px] font-semibold break-words">{selected.title}</h3>
                <p className="text-[12px] text-fg-subtle">
                  {[
                    selected.projects[0]?.title,
                    t(`documentKind.${selected.kind}`),
                    selected.hasFile ? formatBytes(selected.sizeBytes, { f }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-[6px]">
                {[t(`documentKind.${selected.kind}`), ...selected.tags].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-[7px] bg-sunk px-2 py-[3px] text-[11.5px] text-fg-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <span className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                {t("cf.linked")}
              </span>
              {selected.other.filter((o) => o.type === "task").length === 0 ? (
                <p className="text-[12.5px] text-fg-subtle">{t("cf.noLinked")}</p>
              ) : (
                selected.other
                  .filter((o) => o.type === "task")
                  .map((o) => (
                    <Link
                      key={o.id}
                      href={hrefKeepingState(`/objects/${o.id}`, params)}
                      onClick={() => playSound("click")}
                      className="flex items-center gap-2 rounded-[11px] border border-border px-3 py-2 text-[13px] transition-colors hover:bg-sunk"
                    >
                      <span className="min-w-0 flex-1 truncate">{o.title}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))
              )}
              <Link
                href={hrefKeepingState(`/objects/${selected.id}`, params)}
                className="text-[12.5px] font-semibold text-accent-ink hover:underline"
              >
                {t("cf.openPage")}
              </Link>
              <DeleteButton id={selected.id} block />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-fg-subtle">{t("cf.choose")}</p>
        )}
      </aside>
    </div>,
  );
}
