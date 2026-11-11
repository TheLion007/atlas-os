"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeWriteError, useCreateObject, useGraph, useProgress } from "@/client/hooks";
import { applyProposal, undoBatch } from "@/client/assistant-apply";
import { useSource } from "@/client/provider";
import { Mascot } from "@/design/Mascot";
import {
  buildWorkspace,
  scopeSentence,
  scopeWorkspace,
  type AssistantScope,
  type Proposal,
} from "@/domain/assistant-plan";
import { runAssistant } from "@/domain/assistant-run";
import { POINTS_PER_TASK, batchSize, useAssistantUndo } from "@/lib/assistant-undo";
import { AssistantProposal } from "./AssistantProposal";
import type { ApiObject } from "@/domain/api-types";
import { descendantsOf } from "@/domain/project-view";
import { triage, triageCount, triageInScope, type TriageGroup } from "@/domain/triage";
import { projectColor } from "@/design/palette";
import { useI18n } from "@/i18n/I18nProvider";
import { celebrate, useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import { assistantContext, SYSTEM_PROMPT, type OllamaErrorCode } from "@/domain/ollama";
import { useOllamaStore } from "@/lib/ollama-store";
import { OllamaTutorial } from "../ai/OllamaTutorial";
import { askOllama, useOllama, warmUpModel, type UseOllama } from "../ai/use-ollama";
import { useUi } from "./ui-store";

/** Models already loaded into memory during this session: they are not warmed up twice. */
const warmed = new Set<string>();

function dueOf(n: ApiObject): string | null {
  const d = n.details?.due;
  return typeof d === "string" && d ? d : null;
}

/**
 * The assistant as the design draws it: write loose ideas, one per line, and it proposes where each
 * goes (an existing project, a new project or sub-project, or the inbox); "Add all" then really
 * creates them. Three quick questions answer from the real data. Nothing is sent anywhere.
 *
 * Opened from a project, a sub-project or a task (`scope`), it works inside that element only:
 * what it creates goes there and its answers are about it, until "Global mode" is chosen.
 */
function AssistantMain({ ollama, scope }: { ollama: UseOllama; scope: AssistantScope | null }) {
  const { t } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const progress = useProgress(30);
  const create = useCreateObject();
  const pushToast = useUi((s) => s.pushToast);
  const react = useFeedback((s) => s.react);
  const [idea, setIdea] = useState("");
  // The context is on by default every time the assistant opens; global mode is a choice.
  const [globalMode, setGlobalMode] = useState(false);
  const active = globalMode ? null : scope;
  const [thinking, setThinking] = useState(false);
  const [groups, setGroups] = useState<TriageGroup[] | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [aiError, setAiError] = useState<OllamaErrorCode | "cancelled" | "weak" | "empty" | null>(
    null,
  );
  const [errorFrom, setErrorFrom] = useState<"ask" | "organize">("ask");
  // The structured mode: the model's proposal, the workspace it was made for, and its progress.
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [workspace, setWorkspace] = useState<ReturnType<typeof buildWorkspace> | null>(null);
  const [reading, setReading] = useState(false);
  const [progress2, setProgress2] = useState<{ done: number; total: number } | null>(null);
  const [partial, setPartial] = useState(0);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const mascot = usePrefs((st) => st.mascot);
  const lastBatch = useAssistantUndo((st) => st.batch);
  const remember = useAssistantUndo((st) => st.remember);
  const aiReady = ollama.state === "ready" && !!ollama.model;
  // As soon as the assistant opens, the model starts loading so the first answer is quick.
  const [warmDone, setWarmDone] = useState<string | null>(null);
  const warmModel = aiReady ? ollama.model : null;
  const loading = !!warmModel && !warmed.has(warmModel) && warmDone !== warmModel;
  useEffect(() => {
    if (!warmModel || warmed.has(warmModel)) return;
    void warmUpModel(warmModel).then((ok) => {
      if (ok) warmed.add(warmModel);
      setWarmDone(warmModel);
    });
  }, [warmModel]);
  const [replyModel, setReplyModel] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const openTutorial = useOllamaStore((st) => st.openTutorial);
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);
  const projects = useMemo(
    () => nodes.filter((n) => n.type === "project" && n.status !== "dropped"),
    [nodes],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  /** What the active context holds (itself included), or null when the whole app is in play. */
  const inside = useMemo(() => {
    if (!active) return null;
    const ids = descendantsOf(active.id, edges);
    ids.add(active.id);
    return ids;
  }, [active, edges]);

  const switchMode = (next: boolean) => {
    playSound("click");
    abort.current?.abort();
    setGlobalMode(next);
    // A proposal belongs to the mode it was made in.
    setProposal(null);
    setGroups(null);
    setReply(null);
    setAiError(null);
  };

  const organize = () => {
    const text = idea.trim();
    if (!text) {
      playSound("error");
      pushToast(t("assistant.nothingToSort"), undefined, undefined);
      react("idle", t("assistant.emptyPage"));
      return;
    }
    if (aiReady) {
      void organizeAi(text);
      return;
    }
    setThinking(true);
    setGroups(null);
    setReply(null);
    window.setTimeout(() => {
      if (active) {
        // Inside a context nothing is matched against other projects: it all goes here.
        playSound("create");
        setGroups(triageInScope(triage(text, []), active));
        setThinking(false);
        react("happy", t("assistant.sorted"));
        return;
      }
      const tasks = nodes.filter((n) => n.type === "task");
      const mapped = projects.map((p) => {
        const inside = descendantsOf(p.id, edges);
        return {
          id: p.id,
          title: p.title,
          words: tasks.filter((x) => inside.has(x.id)).map((x) => x.title),
        };
      });
      playSound("create");
      setGroups(triage(text, mapped));
      setThinking(false);
      react("happy", t("assistant.sorted"));
    }, 700);
  };

  const organizeAi = async (text: string) => {
    if (!ollama.model || reading) return;
    playSound("click");
    setGroups(null);
    setReply(null);
    setProposal(null);
    setAiError(null);
    setPartial(0);
    setReading(true);
    react("happy", null);
    const ws = active ? scopeWorkspace(active, nodes, edges) : buildWorkspace(nodes, edges);
    const ctl = new AbortController();
    abort.current = ctl;
    const model = ollama.model;
    const res = await runAssistant({
      text,
      workspace: ws,
      scope: active,
      today,
      signal: ctl.signal,
      ask: (messages, opts) => askOllama(model, messages, ctl.signal, opts),
      onProgress: (done, total) => setProgress2({ done, total }),
    });
    abort.current = null;
    setReading(false);
    setProgress2(null);
    if (res.ok) {
      playSound("create");
      setWorkspace(ws);
      setProposal(res.proposal);
      setPartial(res.failedChunks);
      setReplyModel(model);
      react("happy", t("assistant.sorted"));
    } else {
      if (res.code !== "cancelled") playSound("error");
      setErrorFrom("organize");
      setAiError(res.code);
      if (res.code === "model_missing" || res.code === "unreachable") void ollama.check();
    }
  };

  const createProposal = async () => {
    if (!proposal || !source || creating) return;
    setCreating(true);
    try {
      const batch = await applyProposal(source, proposal, t("assistant.createdBy"));
      await queryClient.invalidateQueries({ queryKey: [] });
      remember(batch);
      usePrefs.getState().addPoints(batch.objectIds.length * POINTS_PER_TASK);
      celebrate({ x: window.innerWidth - 240, y: 200 });
      pushToast(
        t("ai.struct.created", { count: batchSize(batch) }),
        undefined,
        batch.objectIds.length * POINTS_PER_TASK,
      );
      setProposal(null);
      setIdea("");
    } catch {
      playSound("error");
      await queryClient.invalidateQueries({ queryKey: [] });
      pushToast(t("ai.struct.failed"));
    } finally {
      setCreating(false);
    }
  };

  const undoLast = async () => {
    if (!lastBatch || !source || creating) return;
    setCreating(true);
    try {
      await undoBatch(source, lastBatch);
      usePrefs.getState().addPoints(-lastBatch.objectIds.length * POINTS_PER_TASK);
      pushToast(t("ai.struct.undone", { count: batchSize(lastBatch) }));
      remember(null);
      playSound("click");
    } catch (e) {
      playSound("error");
      pushToast(describeWriteError(e, t));
    } finally {
      await queryClient.invalidateQueries({ queryKey: [] });
      setCreating(false);
    }
  };

  const addAll = async () => {
    if (!groups || busy) return;
    setBusy(true);
    let made = 0;
    try {
      const ids = new Map<string, string>();
      const task = async (title: string, high: boolean, parent: string | null) => {
        await create.mutateAsync({
          input: {
            type: "task",
            title: title.charAt(0).toUpperCase() + title.slice(1),
            status: "draft",
            tags: [high ? "Urgent" : "Assistant"],
            confidence: null,
            details: { description: "", due: null },
          },
          relations: parent ? [{ kind: "contains", direction: "in", other: parent }] : [],
        });
        made++;
      };
      for (const g of groups) {
        let parent: string | null = null;
        if (g.kind === "new-project" || g.kind === "new-sub") {
          // Inside a project or a sub-project, what is new is made in it.
          const home = active && active.kind !== "task" ? active.id : null;
          const under = (g.kind === "new-sub" && g.under ? ids.get(g.under) : null) ?? home;
          // A sub-project needs a project above it; without one it becomes a project of its own.
          const asSub = under !== null && (g.kind === "new-sub" || home !== null);
          const created = await create.mutateAsync({
            input: {
              type: asSub ? "sub_project" : "project",
              title: g.name,
              status: "active",
              tags: [],
              confidence: null,
              details: { description: t("assistant.createdBy"), startDate: null, targetDate: null },
            },
            relations: asSub && under ? [{ kind: "contains", direction: "in", other: under }] : [],
          });
          ids.set(g.name, created.id);
          parent = created.id;
        } else if (g.kind === "existing") parent = g.projectId;
        for (const it of g.items) await task(it.title, it.high, parent);
      }
      usePrefs.getState().addPoints(made * POINTS_PER_TASK);
      celebrate({ x: window.innerWidth - 240, y: 200 });
      pushToast(t("assistant.added", { count: made }), undefined, made * POINTS_PER_TASK);
      setGroups(null);
      setIdea("");
    } catch (e) {
      playSound("error");
      pushToast(describeWriteError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const ask = (kind: "week" | "urgent" | "day") => {
    playSound("click");
    setGroups(null);
    const open = nodes
      .filter((n) => n.type === "task" && (n.status === "draft" || n.status === "active"))
      .filter((n) => !inside || (inside.has(n.id) && n.id !== active?.id))
      .sort((a, b) => (dueOf(a) ?? "9999").localeCompare(dueOf(b) ?? "9999"));
    let text: string;
    if (kind === "week") {
      const since = new Date(`${today}T12:00:00Z`);
      since.setUTCDate(since.getUTCDate() - 6);
      const from = since.toISOString().slice(0, 10);
      const week = (progress.data ?? []).filter(
        (e) =>
          e.day >= from &&
          e.day <= today &&
          (!inside || (e.objectId !== null && inside.has(e.objectId))),
      );
      const per = new Map<string, number>();
      for (const e of week) if (e.projectId) per.set(e.projectId, (per.get(e.projectId) ?? 0) + 1);
      const top = [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
      text =
        week.length === 0
          ? t("assistant.weekNone")
          : t("assistant.week", { count: week.length }) +
            (top.length
              ? " " +
                t("assistant.weekTop", {
                  list: top.map(([id, n]) => `« ${byId.get(id)?.title ?? "?"} » (${n})`).join(", "),
                })
              : "");
    } else if (kind === "urgent") {
      const limit = new Date(`${today}T12:00:00Z`);
      limit.setUTCDate(limit.getUTCDate() + 3);
      const soon = limit.toISOString().slice(0, 10);
      const urgent = open.filter((n) => n.tags.includes("Urgent") || (dueOf(n) ?? "9999") <= soon);
      text = urgent.length
        ? [
            t("assistant.urgent", { count: urgent.length }),
            ...urgent.slice(0, 4).map((n) => `• ${n.title}${dueOf(n) ? ` (${dueOf(n)})` : ""}`),
          ].join("\n")
        : t("assistant.urgentNone");
    } else {
      text = open.length
        ? [t("assistant.day"), ...open.slice(0, 4).map((n) => `• ${n.title}`)].join("\n")
        : t("assistant.dayNone");
    }
    setReply(text);
    setReplyModel(null);
    setAiError(null);
    react("happy", null);
  };

  const askAi = async () => {
    const text = question.trim();
    if (!text || asking || ollama.state !== "ready" || !ollama.model) return;
    playSound("click");
    setGroups(null);
    setReply(null);
    setProposal(null);
    setAiError(null);
    setErrorFrom("ask");
    setAsking(true);
    react("happy", null);
    const ctl = new AbortController();
    abort.current = ctl;
    const model = ollama.model;
    const res = await askOllama(
      model,
      [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n\n${assistantContext(nodes, edges, today, active)}`,
        },
        { role: "user", content: text },
      ],
      ctl.signal,
    );
    abort.current = null;
    setAsking(false);
    if (res.ok) {
      playSound("check");
      setReply(res.answer);
      setReplyModel(model);
      setQuestion("");
    } else {
      if (res.code !== "cancelled") playSound("error");
      setAiError(res.code);
      // A vanished model or a closed Ollama changes what the app knows: look again.
      if (res.code === "model_missing" || res.code === "unreachable") void ollama.check();
    }
  };

  const count = groups ? triageCount(groups) : 0;
  const asks = [
    ["week", t("assistant.askWeek")],
    ["urgent", t("assistant.askUrgent")],
    ["day", t("assistant.askDay")],
  ] as const;

  return (
    <div className="flex min-h-0 grow flex-col">
      {scope && (
        <div className="flex shrink-0 items-center gap-2 px-5 pt-3">
          <span
            role="status"
            aria-label={t("ai.scope.label")}
            title={
              active ? t("ai.scope.in", { where: scopeSentence(active) }) : t("ai.scope.global")
            }
            className="inline-flex min-w-0 items-center gap-[7px] rounded-full border border-border bg-sunk px-[10px] py-[4px] text-[12px]"
          >
            <span
              className="size-[6px] shrink-0 rounded-full"
              style={{ background: active ? "var(--color-accent)" : "var(--color-fg-subtle)" }}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate font-medium">
              {active ? active.trail.join(" › ") : t("ai.scope.global")}
            </span>
            {active && (
              <span className="shrink-0 text-[10.5px] text-fg-subtle">
                {t(`ai.kind.${active.kind}`)}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => switchMode(!globalMode)}
            aria-pressed={globalMode}
            className="ml-auto max-w-[45%] shrink-0 truncate rounded-full border border-border-strong bg-surface px-[10px] py-[4px] text-[12px] font-medium transition-[background-color,transform] hover:bg-sunk active:scale-[0.97]"
          >
            {globalMode ? t("ai.scope.back", { name: scope.name }) : t("ai.scope.goGlobal")}
          </button>
        </div>
      )}
      <div className="min-h-0 grow overflow-y-auto px-5 pt-4 pb-5">
        <div className="rounded-[16px] border border-border bg-surface p-3 shadow-card">
          <textarea
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                organize();
              }
            }}
            aria-label={t("assistant.ideas")}
            placeholder={
              active
                ? t(active.kind === "task" ? "ai.scope.placeholderTask" : "ai.scope.placeholder", {
                    name: active.name,
                  })
                : aiReady
                  ? t("ai.struct.placeholder")
                  : t("assistant.placeholder")
            }
            rows={6}
            className="w-full resize-y bg-transparent text-[13.5px] leading-[1.55] outline-none! placeholder:text-fg-subtle"
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                playSound("click");
                setIdea(
                  active && aiReady
                    ? t(active.kind === "task" ? "ai.scope.sampleTask" : "ai.scope.sample")
                    : aiReady
                      ? t("ai.struct.sample")
                      : t("assistant.sample"),
                );
              }}
              className="h-8 rounded-[10px] border border-border-strong bg-surface px-3 text-[12px] font-medium transition-[background-color,transform] hover:bg-sunk active:scale-[0.97]"
            >
              {t("assistant.example")}
            </button>
            <button
              type="button"
              onClick={organize}
              disabled={thinking || reading || creating}
              className="inline-flex h-8 items-center gap-2 rounded-[10px] bg-accent px-3 text-[12.5px] font-semibold text-on-accent transition-transform active:scale-[0.97] disabled:opacity-70"
            >
              {thinking || reading ? t("assistant.sorting") : t("assistant.organize")}
              <span className="num rounded-[5px] bg-on-accent/20 px-[5px] py-px text-[10px]">
                {t("assistant.organizeKey")}
              </span>
            </button>
          </div>
        </div>

        {lastBatch && !proposal && !reading && (
          <button
            type="button"
            onClick={() => void undoLast()}
            disabled={creating}
            className="pop-in mt-3 h-9 w-full rounded-[11px] border border-border-strong bg-surface px-3 text-[12.5px] font-semibold transition-[background-color,transform] hover:bg-sunk active:scale-[0.98] disabled:opacity-60"
          >
            {t("ai.struct.undo", { count: batchSize(lastBatch) })}
          </button>
        )}

        {reading && (
          <div
            role="status"
            className="pop-in mt-4 flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3 text-[13px] shadow-card"
          >
            <Mascot kind={mascot} mood="idle" size={44} track={false} />
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-fg-muted">
                {loading ? t("ai.struct.firstLoad") : t("ai.struct.thinking")}
              </span>
              {progress2 && progress2.total > 1 && (
                <span className="num text-[11px] text-fg-subtle">
                  {t("ai.struct.part", {
                    done: Math.min(progress2.done + 1, progress2.total),
                    total: progress2.total,
                  })}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="shrink-0 rounded-[9px] border border-border-strong px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-sunk"
            >
              {t("ai.struct.stop")}
            </button>
          </div>
        )}

        {proposal && workspace && (
          <>
            <AssistantProposal
              proposal={proposal}
              workspace={workspace}
              busy={creating}
              onChange={setProposal}
              onCreate={() => void createProposal()}
              onDiscard={() => {
                playSound("click");
                setProposal(null);
              }}
            />
            {partial > 0 && (
              <p className="mt-2 text-[12px] text-fg-muted">
                {t("ai.struct.partial", { count: partial })}
              </p>
            )}
            {replyModel && (
              <p className="num mt-2 text-[10.5px] text-fg-subtle">
                {t("ai.answerFrom", { model: replyModel })}
              </p>
            )}
          </>
        )}

        {groups && (
          <section aria-label={t("assistant.proposal")} className="mt-4 flex flex-col gap-3">
            <h3 className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              {t("assistant.proposal")}
            </h3>
            {groups.length === 0 && (
              <p className="text-[13px] text-fg-muted">{t("assistant.nothingFound")}</p>
            )}
            {groups.map((g, i) => {
              const project = g.kind === "existing" ? byId.get(g.projectId) : undefined;
              const name = g.kind === "inbox" ? t("assistant.inbox") : g.name;
              const hex = project
                ? projectColor(project.color, project.id)
                : g.kind === "inbox"
                  ? "var(--color-fg-subtle)"
                  : "var(--color-accent)";
              const chip =
                g.kind === "new-project"
                  ? t("assistant.newProject")
                  : g.kind === "new-sub"
                    ? t("assistant.newSub")
                    : g.kind === "inbox"
                      ? t("assistant.inboxChip")
                      : t("assistant.existing");
              return (
                <div
                  key={`${g.kind}-${name}-${i}`}
                  className="rise-in rounded-[14px] border border-border bg-surface px-3 py-[10px] shadow-card"
                  style={{ animationDelay: `${i * 110}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: hex }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {name}
                    </span>
                    <span className="rounded-full bg-sunk px-2 py-[2px] text-[10.5px] text-fg-muted">
                      {chip}
                    </span>
                  </div>
                  <ul className="mt-2 divide-y divide-border">
                    {g.items.map((it) => (
                      <li
                        key={it.title}
                        className="flex items-center gap-3 py-[7px] pl-4 text-[12.5px]"
                      >
                        <span className="min-w-0 flex-1">{it.title}</span>
                        <span
                          className={
                            it.high
                              ? "num text-[10.5px] text-accent-ink"
                              : "num text-[10.5px] text-fg-subtle"
                          }
                        >
                          {it.high ? t("assistant.high") : t("assistant.normal")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {count > 0 && (
              <button
                type="button"
                onClick={() => void addAll()}
                disabled={busy}
                className="h-11 rounded-[13px] bg-fg text-[13.5px] font-semibold text-bg transition-transform active:scale-[0.98] disabled:opacity-70"
              >
                {t("assistant.addAll", { count })}
              </button>
            )}
          </section>
        )}

        {asking && (
          <div
            role="status"
            className="pop-in mt-4 flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3 text-[13px] shadow-card"
          >
            <span className="relative grid size-3 place-items-center" aria-hidden="true">
              <span className="absolute size-3 animate-ping rounded-full bg-accent/40" />
              <span className="size-[6px] rounded-full bg-accent" />
            </span>
            <span className="min-w-0 flex-1 text-fg-muted">{t("ai.thinking")}</span>
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="shrink-0 rounded-[9px] border border-border-strong px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-sunk"
            >
              {t("ai.cancel")}
            </button>
          </div>
        )}

        {aiError && !asking && (
          <div
            role="alert"
            className="pop-in mt-4 flex flex-col gap-2 rounded-[14px] border border-border bg-sunk px-4 py-3 text-[13px] leading-[1.5]"
          >
            <span>
              {aiError === "cancelled"
                ? t("ai.cancelled")
                : t(`ai.err.${aiError}`, { model: ollama.model ?? "" })}
            </span>
            {aiError !== "cancelled" && aiError !== "local_only" && aiError !== "empty" && (
              <button
                type="button"
                onClick={() => (errorFrom === "organize" ? organize() : void askAi())}
                className="self-start rounded-[9px] border border-border-strong bg-surface px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-sunk"
              >
                {t("ai.retry")}
              </button>
            )}
          </div>
        )}

        {reply && !groups && !asking && (
          <div className="pop-in mt-4 rounded-[14px] border border-border bg-surface px-4 py-3 shadow-card">
            <p role="status" className="text-[13px] leading-[1.6] whitespace-pre-line">
              {reply}
            </p>
            {replyModel && (
              <p className="num mt-2 text-[10.5px] text-fg-subtle">
                {t("ai.answerFrom", { model: replyModel })}
              </p>
            )}
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border px-5 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void askAi();
        }}
      >
        {ollama.state === "ready" ? (
          <>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={asking}
              aria-label={t("ai.ask")}
              placeholder={
                active ? t("ai.scope.ask", { name: active.name }) : t("ai.askPlaceholder")
              }
              className="h-10 min-w-0 flex-1 rounded-[12px] border border-border-strong bg-surface px-3 text-[13px] outline-none! placeholder:text-fg-subtle focus-visible:border-accent disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={asking || question.trim() === ""}
              aria-label={t("ai.send")}
              className="grid size-10 flex-none place-items-center rounded-[12px] bg-accent text-on-accent transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-90 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              playSound("click");
              openTutorial();
            }}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-dashed border-border-strong px-3 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-sunk"
          >
            <span className="min-w-0 flex-1 truncate">
              {ollama.pending ? t("ai.checking") : t("ai.askOff")}
            </span>
            <span className="shrink-0 font-semibold text-accent-ink">{t("ai.configure")}</span>
          </button>
        )}
      </form>

      <div className="flex flex-wrap gap-2 px-5 py-3">
        {asks.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => ask(k)}
            className="rounded-full border border-border-strong bg-surface px-3 py-[6px] text-[12px] transition-[background-color,transform] hover:bg-sunk active:scale-[0.97]"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The assistant. When the local Ollama is not connected, its first screen is the tutorial that
 * connects it; "Plus tard" closes the tutorial and the rest of the assistant (sorting ideas, the
 * quick questions) keeps working with only the AI answers off. Ollama is looked for when the
 * assistant opens, and every few seconds while the tutorial is on screen.
 */
export function AssistantPanel({ scope = null }: { scope?: AssistantScope | null }) {
  const ollama = useOllama(false);
  const tutorial = useOllamaStore((st) => st.tutorial);
  const dismissed = useOllamaStore((st) => st.dismissed);
  const dismiss = useOllamaStore((st) => st.dismiss);
  const closeTutorial = useOllamaStore((st) => st.closeTutorial);
  // The tutorial stays up until it is closed, so the success of the last step is seen even though
  // the detection already says "ready".
  const [sticky, setSticky] = useState(false);
  const wanted = !ollama.pending && (tutorial || (!dismissed && ollama.state !== "ready"));
  if (wanted && !sticky) setSticky(true);
  const show = wanted || sticky;
  // While it is on screen, look again every few seconds (a second observer, same data).
  useOllama(show);

  if (show)
    return (
      <OllamaTutorial
        ollama={ollama}
        onLater={() => {
          setSticky(false);
          dismiss();
        }}
        onDone={() => {
          setSticky(false);
          closeTutorial();
        }}
      />
    );
  return <AssistantMain ollama={ollama} scope={scope} />;
}
