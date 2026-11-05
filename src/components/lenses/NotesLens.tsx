"use client";

import { useSelectedObject } from "@/lib/deletion-store";
import { DeleteButton } from "../shell/DeleteButton";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  describeError,
  describeWriteError,
  useCreateObject,
  useGraph,
  useUpdateObject,
} from "@/client/hooks";
import { useSource } from "@/client/provider";
import type { ApiObject } from "@/domain/api-types";
import {
  groupNotes,
  noteBlocks,
  noteLinks,
  projectOfNote,
  summarizeNote,
  type BlockType,
  type NoteBlock,
} from "@/domain/notes-view";
import { Mascot } from "@/design/Mascot";
import { projectColor } from "@/design/palette";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

const ADD: { type: BlockType; glyph: string; key: string }[] = [
  { type: "heading", glyph: "H", key: "nt.b.heading" },
  { type: "paragraph", glyph: "¶", key: "nt.b.paragraph" },
  { type: "list", glyph: "•", key: "nt.b.list" },
  { type: "todo", glyph: "☐", key: "nt.b.todo" },
  { type: "quote", glyph: "“", key: "nt.b.quote" },
  { type: "code", glyph: "</>", key: "nt.b.code" },
];

const EDITABLE = "outline-none! focus-visible:outline-none!";

/**
 * Notes, as in the design: the list by project on the left, the page being written in the middle
 * (every block is edited where it stands and saved when you leave it), and on the right a
 * three-line summary plus the links going out of and into the note.
 */
export function NotesLens() {
  const { t, f, typeLabel } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const params = useSearchParams();
  const create = useCreateObject();
  const update = useUpdateObject();
  const pushToast = useUi((s) => s.pushToast);
  const react = useFeedback((s) => s.react);
  const kind = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(params.get("n"));
  const [summary, setSummary] = useState<{ note: string; text: string; shown: number } | null>(
    null,
  );
  const focusAfter = useRef<string | null>(null);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);
  const groups = useMemo(
    () => groupNotes(nodes, edges, query, t("nt.global")),
    [nodes, edges, query, t],
  );
  const all = useMemo(() => groups.flatMap((g) => g.notes), [groups]);
  const note =
    nodes.find((n) => n.id === chosen && n.type === "note") ??
    nodes.find((n) => n.id === all[0]?.id);
  useSelectedObject(note?.id);
  const blocks = useMemo(() => (note ? noteBlocks(note) : []), [note]);

  // Typewriter for the summary, like the design's.
  useEffect(() => {
    if (!summary || summary.shown >= summary.text.length) return;
    const id = window.setTimeout(
      () => setSummary((s) => (s ? { ...s, shown: Math.min(s.text.length, s.shown + 3) } : s)),
      18,
    );
    return () => window.clearTimeout(id);
  }, [summary]);

  // A block just added takes the cursor.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-block="${id}"] [data-edit]`);
    if (el) {
      focusAfter.current = null;
      el.focus();
    }
  });

  if (graph.isPending) return <LoadingState label={t("nav.notes")} lines={5} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const fail = (e: unknown) => {
    playSound("error");
    pushToast(describeWriteError(e, t));
  };

  const save = (n: ApiObject, next: NoteBlock[]) =>
    update.mutate(
      {
        id: n.id,
        patch: {
          details: {
            ...(n.details ?? {}),
            blocks: next.map((b) => ({
              id: b.id,
              type: b.type,
              text: b.text,
              ...(b.type === "todo" ? { checked: b.checked === true } : {}),
            })),
          },
        },
      },
      { onError: fail },
    );

  const newNote = () => {
    playSound("click");
    const project = note ? projectOfNote(note, nodes, edges) : null;
    create.mutate(
      {
        input: {
          type: "note",
          title: t("nt.untitled"),
          status: "active",
          tags: [],
          confidence: null,
          details: { pinned: false, blocks: [{ id: "b1", type: "paragraph", text: "" }] },
        },
        relations: project ? [{ kind: "references", direction: "out", other: project.id }] : [],
      },
      {
        onSuccess: (created) => {
          playSound("create");
          react("happy", null);
          setChosen(created.id);
          setQuery("");
          focusAfter.current = "b1";
          pushToast(t("nt.created"));
        },
        onError: fail,
      },
    );
  };

  const addBlock = (type: BlockType) => {
    if (!note) return;
    playSound("click");
    const top = Math.max(0, ...blocks.map((b) => Number(/^b(\d+)$/.exec(b.id)?.[1] ?? 0)));
    const id = `b${top + 1}`;
    save(note, [...blocks, { id, type, text: "", ...(type === "todo" ? { checked: false } : {}) }]);
    focusAfter.current = id;
  };

  const editBlock = (b: NoteBlock, text: string) => {
    if (!note) return;
    if (text === b.text) return;
    save(
      note,
      blocks.map((x) => (x.id === b.id ? { ...x, text } : x)),
    );
  };

  const toggle = (b: NoteBlock) => {
    if (!note) return;
    const checked = !(b.checked === true);
    playSound(checked ? "check" : "drop");
    save(
      note,
      blocks.map((x) => (x.id === b.id ? { ...x, checked } : x)),
    );
  };

  const summarize = () => {
    if (!note) return;
    playSound("click");
    const text = summarizeNote(blocks) || t("nt.sumNothing");
    setSummary({ note: note.id, text, shown: 0 });
    react("happy", null);
  };

  if (all.length === 0 && !query)
    return (
      <EmptyState
        title={t("nt.none")}
        description={t("nt.noneBody")}
        action={
          <button
            type="button"
            onClick={newNote}
            className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-fg px-4 text-bg"
          >
            {t("nt.new")}
          </button>
        }
      />
    );

  const project = note ? projectOfNote(note, nodes, edges) : null;
  const links = note ? noteLinks(note, nodes, edges) : { out: [], back: [] };
  const href = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const now = source ? new Date(`${source.today()}T12:00:00Z`) : new Date();
  const sum = summary && note && summary.note === note.id ? summary : null;

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-wrap items-start gap-[22px] px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      {/* The list */}
      <div className="flex w-full flex-none flex-col gap-3 md:w-[250px]">
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[11px] border border-border bg-surface px-[11px] py-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-fg-subtle)"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.5-4.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("nt.search")}
              aria-label={t("nt.search")}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none! placeholder:text-fg-subtle"
            />
          </label>
          <button
            type="button"
            onClick={newNote}
            title={t("nt.new")}
            aria-label={t("nt.new")}
            className="group grid w-[38px] place-items-center rounded-[11px] bg-fg text-bg"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="transition-transform duration-[350ms] ease-(--ease-spring) group-hover:rotate-90"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        {all.length === 0 && <p className="px-2 text-[13px] text-fg-subtle">{t("nt.noMatch")}</p>}
        {groups.map((g) => (
          <div key={g.projectId ?? "global"} className="flex flex-col gap-[2px]">
            <span className="num flex items-center gap-[7px] px-2 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
              <i
                className="size-[7px] rounded-[2px]"
                style={{
                  background: g.projectId
                    ? projectColor(g.color, g.projectId)
                    : "var(--color-fg-subtle)",
                }}
              />
              {g.label}
            </span>
            {g.notes.map((n) => (
              <button
                key={n.id}
                type="button"
                data-object-id={n.id}
                onClick={() => {
                  playSound("click");
                  setChosen(n.id);
                }}
                aria-current={note?.id === n.id ? "true" : undefined}
                className={cn(
                  "flex flex-col gap-[3px] rounded-[12px] px-3 py-[10px] text-left transition-[background-color,transform] duration-200 hover:translate-x-[3px] hover:bg-surface",
                  note?.id === n.id ? "bg-surface shadow-card" : "bg-transparent",
                )}
              >
                <span className="text-[13.5px] font-semibold">{n.title}</span>
                <span className="max-w-[220px] truncate text-[12px] text-fg-subtle">
                  {n.excerpt}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* The page */}
      {note && (
        <article
          key={note.id}
          className="screen-in flex min-h-[640px] min-w-0 flex-[1_1_520px] flex-col gap-[6px] rounded-[24px] border border-border bg-surface px-6 pt-[30px] pb-10 shadow-card md:px-11 md:pt-[34px]"
        >
          <div className="mb-[6px] flex items-center gap-[10px] text-[12px] text-fg-subtle">
            <span className="flex items-center gap-[6px] rounded-[7px] bg-sunk px-[9px] py-1 font-semibold text-fg-muted">
              <i
                className="size-[7px] rounded-[2px]"
                style={{
                  background: project
                    ? projectColor(project.color, project.id)
                    : "var(--color-fg-subtle)",
                }}
              />
              {project?.title ?? t("nt.global")}
            </span>
            <span>{t("nt.edited", { when: f.ago(note.updatedAt, now) })}</span>
            <span className="ml-auto">
              {blocks.length === 1 ? t("nt.blocksOne") : t("nt.blocks", { count: blocks.length })}
            </span>
            <DeleteButton id={note.id} />
          </div>
          <h1
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => {
              const title = e.currentTarget.innerText.trim();
              if (title && title !== note.title)
                update.mutate({ id: note.id, patch: { title } }, { onError: fail });
              else e.currentTarget.innerText = note.title;
            }}
            className={cn(
              "mb-[10px] font-display text-[36px] leading-[1.1] font-extrabold tracking-[-0.03em]",
              EDITABLE,
            )}
          >
            {note.title}
          </h1>

          {blocks.length === 0 && <p className="text-fg-subtle">{t("nt.empty")}</p>}
          {blocks.map((b) => {
            const edit = {
              "data-edit": "1",
              contentEditable: true,
              suppressContentEditableWarning: true,
              onBlur: (e: React.FocusEvent<HTMLElement>) =>
                editBlock(b, e.currentTarget.innerText.replace(/\n+$/, "")),
            } as const;
            return (
              <div
                key={b.id}
                data-block={b.id}
                className="-mx-2 rounded-[8px] px-2 py-[3px] transition-colors duration-200 hover:bg-hover"
              >
                {b.type === "heading" && (
                  <h2
                    {...edit}
                    className={cn(
                      "mt-[14px] mb-[2px] font-display text-[21px] font-bold",
                      EDITABLE,
                    )}
                  >
                    {b.text}
                  </h2>
                )}
                {b.type === "paragraph" && (
                  <p
                    {...edit}
                    className={cn("my-1 text-[15.5px] leading-[1.65] text-pretty", EDITABLE)}
                  >
                    {b.text}
                  </p>
                )}
                {b.type === "list" && (
                  <div className="flex items-baseline gap-3 text-[15.5px] leading-[1.6]">
                    <i className="size-[6px] flex-none -translate-y-[2px] rounded-full bg-accent" />
                    <span {...edit} className={cn("flex-1", EDITABLE)}>
                      {b.text}
                    </span>
                  </div>
                )}
                {b.type === "todo" && (
                  <div className="flex items-center gap-[11px] text-[15.5px] leading-[1.6]">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={b.checked === true}
                      aria-label={t("nt.checkbox", { text: b.text })}
                      onClick={() => toggle(b)}
                      className={cn(
                        "grid size-[19px] flex-none place-items-center rounded-[6px] border-[1.6px] p-0 transition-[background-color,border-color,transform] duration-[350ms] ease-(--ease-spring) hover:scale-[1.15]",
                        b.checked
                          ? "border-accent bg-accent"
                          : "border-border-strong bg-transparent",
                      )}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-on-accent)"
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 12.5l4.5 4.5L19 7.5"
                          strokeDasharray="22"
                          strokeDashoffset={b.checked ? 0 : 22}
                          style={{ transition: "stroke-dashoffset .3s" }}
                        />
                      </svg>
                    </button>
                    <span
                      {...edit}
                      className={cn(
                        "flex-1 transition-opacity duration-300",
                        EDITABLE,
                        b.checked && "line-through opacity-50",
                      )}
                    >
                      {b.text}
                    </span>
                  </div>
                )}
                {b.type === "quote" && (
                  <div className="my-[10px] flex gap-3">
                    <span
                      className="font-display text-[44px] leading-[0.9] font-extrabold text-accent"
                      aria-hidden="true"
                    >
                      “
                    </span>
                    <span
                      {...edit}
                      className={cn(
                        "flex-1 pt-[6px] font-display text-[18px] leading-[1.5] font-medium text-fg-muted italic",
                        EDITABLE,
                      )}
                    >
                      {b.text}
                    </span>
                  </div>
                )}
                {b.type === "code" && (
                  <pre
                    {...edit}
                    className={cn(
                      "num my-2 rounded-[12px] bg-code px-4 py-[14px] text-[13px] leading-[1.65] whitespace-pre-wrap text-code-ink",
                      EDITABLE,
                    )}
                  >
                    {b.text}
                  </pre>
                )}
              </div>
            );
          })}

          {links.out.length > 0 && (
            <div className="my-2 flex flex-wrap gap-2">
              {links.out.map((l) => (
                <Link
                  key={l.id}
                  href={href(l.id)}
                  onClick={() => playSound("click")}
                  className="flex items-center gap-[7px] rounded-[9px] border border-border-strong bg-panel px-[11px] py-[5px] text-[13px] transition-[transform,border-color] duration-300 ease-(--ease-spring) hover:-translate-y-[2px] hover:border-accent"
                >
                  <span className="text-[11.5px] text-fg-subtle">{typeLabel(l.type)}</span>
                  <span className="font-semibold">{l.title}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-[18px] flex flex-wrap gap-[6px] border-t border-dashed border-border-strong pt-4">
            <span className="px-1 py-[7px] text-[12px] text-fg-subtle">{t("nt.addBlock")}</span>
            {ADD.map((a) => (
              <button
                key={a.type}
                type="button"
                onClick={() => addBlock(a.type)}
                className="flex items-center gap-[7px] rounded-[9px] border border-border px-[11px] py-[6px] text-[12.5px] transition-[background-color,transform] duration-300 ease-(--ease-spring) hover:-translate-y-[2px] hover:bg-sunk"
              >
                <span className="num min-w-[14px] text-center text-[11px] font-semibold text-accent-ink">
                  {a.glyph}
                </span>
                {t(a.key as never)}
              </button>
            ))}
          </div>
        </article>
      )}

      {/* Summary and links */}
      {note && (
        <aside className="flex min-w-[250px] flex-[0_1_290px] flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-[18px] shadow-card">
            <div className="flex items-center gap-3">
              <Mascot
                kind={kind}
                mood={sum && sum.shown < sum.text.length ? "happy" : "idle"}
                size={54}
                track={tracks}
              />
              <span className="text-[13px] leading-[1.45] text-fg-muted">{t("nt.sumPrompt")}</span>
            </div>
            {sum && (
              <p
                role="status"
                className="min-h-[60px] rounded-[14px] bg-sunk px-[14px] py-3 text-[13.5px] leading-[1.55]"
              >
                {sum.text.slice(0, sum.shown)}
                <span className="ml-[2px] inline-block h-[14px] w-[2px] animate-pulse bg-accent align-[-2px]" />
              </p>
            )}
            <button
              type="button"
              onClick={summarize}
              className="flex items-center justify-center gap-2 rounded-[12px] bg-accent p-[10px] text-[13.5px] font-semibold text-on-accent transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-[2px] active:scale-[0.96]"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
              </svg>
              {t("nt.sumButton")}
            </button>
          </div>
          {links.out.length > 0 && (
            <LinkCard title={t("nt.links")}>
              {links.out.map((l) => (
                <Link
                  key={l.id}
                  href={href(l.id)}
                  className="flex flex-col gap-px rounded-[10px] px-[10px] py-2 text-left transition-colors hover:bg-sunk"
                >
                  <span className="text-[11px] text-fg-subtle">{typeLabel(l.type)}</span>
                  <span className="text-[13px] font-semibold">{l.title}</span>
                </Link>
              ))}
            </LinkCard>
          )}
          {links.back.length > 0 && (
            <LinkCard title={t("nt.backlinks")}>
              {links.back.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    playSound("click");
                    setChosen(l.id);
                  }}
                  className="rounded-[10px] px-[10px] py-2 text-left text-[13px] font-semibold transition-colors hover:bg-sunk"
                >
                  {l.title}
                </button>
              ))}
            </LinkCard>
          )}
        </aside>
      )}
    </div>
  );
}

function LinkCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px] rounded-[20px] border border-border bg-surface p-[18px] shadow-card">
      <span className="num mb-1 text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}
