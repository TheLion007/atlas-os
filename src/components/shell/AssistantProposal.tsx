"use client";

import { useState } from "react";
import {
  childrenOf,
  countProposal,
  isActive,
  isAttach,
  moveNode,
  parentChoices,
  setChecked,
  setTitle,
  withExisting,
  type NodeKind,
  type PNode,
  type Proposal,
  type Workspace,
} from "@/domain/assistant-plan";
import { useI18n } from "@/i18n/I18nProvider";
import { playSound } from "@/lib/feedback/sound";

/** The title as a text field that saves when it loses focus (an empty title is not saved). */
function TitleField({
  node,
  label,
  onSave,
}: {
  node: PNode;
  label: string;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editable = node.existingId === null;
  if (!editable) return <span className="min-w-0 flex-1 truncate">{node.title}</span>;
  return (
    <input
      value={draft ?? node.title}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onSave(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 rounded-[7px] bg-transparent px-1 py-[2px] -mx-1 outline-none! hover:bg-sunk focus-visible:bg-sunk focus-visible:ring-1 focus-visible:ring-accent"
    />
  );
}

/**
 * The assistant's proposal as a tree: plans, projects, sub-projects, then what goes inside. Every
 * new element can be unticked, renamed or moved; the buttons act on what is still ticked.
 */
export function AssistantProposal({
  proposal,
  workspace,
  busy,
  onChange,
  onCreate,
  onDiscard,
}: {
  proposal: Proposal;
  workspace: Workspace;
  busy: boolean;
  onChange: (p: Proposal) => void;
  onCreate: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  const counts = countProposal(proposal);
  const kindLabel = (k: NodeKind) => t(`ai.kind.${k}`);

  const move = (node: PNode, value: string) => {
    playSound("click");
    if (value === "") return onChange(moveNode(proposal, node.key, null));
    if (value.startsWith("real:")) {
      const added = withExisting(proposal, workspace, value.slice(5));
      if (added) onChange(moveNode(added.proposal, node.key, added.key));
      return;
    }
    onChange(moveNode(proposal, node.key, value));
  };

  const mover = (n: PNode) => {
    if (n.kind === "plan" || n.existingId !== null) return null;
    const choices = parentChoices(proposal, n);
    const have = new Set(proposal.nodes.map((x) => x.existingId));
    const wanted = n.kind === "project" ? ["plan"] : ["project", "sub"];
    const others = [...workspace.byId.values()].filter(
      (w) =>
        !have.has(w.id) && wanted.includes(w.kind) && (n.kind !== "project" || w.kind === "plan"),
    );
    return (
      <select
        value={n.parent ?? ""}
        onChange={(e) => move(n, e.target.value)}
        aria-label={t("ai.struct.moveTo", { title: n.title })}
        className="max-w-[44%] shrink-0 truncate rounded-full border border-border bg-sunk px-2 py-[2px] text-[10.5px] text-fg-muted outline-none! focus-visible:border-accent"
      >
        {n.kind === "project" && <option value="">{t("ai.struct.noPlan")}</option>}
        {choices.map((c) => (
          <option key={c.key} value={c.key}>
            {c.title}
          </option>
        ))}
        {others.length > 0 && (
          <optgroup label={t("ai.struct.others")}>
            {others.map((w) => (
              <option key={w.id} value={`real:${w.id}`}>
                {w.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  };

  const row = (n: PNode, depth: number) => {
    const kids = childrenOf(proposal, n.key);
    const active = isActive(proposal, n);
    const isNew = n.existingId === null;
    const hint = n.existingId
      ? isAttach(n, proposal)
        ? t("ai.struct.inPlan")
        : t("ai.struct.exists")
      : null;
    const top = depth === 0;
    return (
      <div
        key={n.key}
        className={
          top
            ? "rise-in rounded-[14px] border border-border bg-surface px-3 py-[10px] shadow-card"
            : "mt-1 border-l border-border pl-3"
        }
      >
        <div className={`flex items-center gap-2 text-[13px] ${active ? "" : "opacity-45"}`}>
          {isNew || isAttach(n, proposal) ? (
            <input
              type="checkbox"
              checked={n.checked}
              onChange={(e) => {
                playSound("click");
                onChange(setChecked(proposal, n.key, e.target.checked));
              }}
              aria-label={t("ai.struct.include", { title: n.title })}
              className="size-[15px] shrink-0 accent-(--color-accent)"
            />
          ) : (
            <span className="size-[15px] shrink-0" aria-hidden="true" />
          )}
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ background: isNew ? "var(--color-accent)" : "var(--color-fg-subtle)" }}
            aria-hidden="true"
          />
          <span className={top ? "flex min-w-0 flex-1 font-semibold" : "flex min-w-0 flex-1"}>
            <TitleField
              node={n}
              label={t("ai.struct.rename", { title: n.title })}
              onSave={(v) => onChange(setTitle(proposal, n.key, v))}
            />
          </span>
          {n.due && <span className="num shrink-0 text-[10.5px] text-fg-subtle">{n.due}</span>}
          <span className="shrink-0 rounded-full bg-sunk px-2 py-[2px] text-[10.5px] text-fg-muted">
            {hint ? `${kindLabel(n.kind)} · ${hint}` : kindLabel(n.kind)}
          </span>
          {mover(n)}
        </div>
        {kids.length > 0 && (
          <div className={top ? "mt-2" : ""}>{kids.map((k) => row(k, depth + 1))}</div>
        )}
      </div>
    );
  };

  const roots = childrenOf(proposal, null);
  return (
    <section aria-label={t("ai.struct.proposal")} className="mt-4 flex flex-col gap-3">
      <h3 className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
        {t("ai.struct.proposal")}
      </h3>
      <p className="text-[12px] text-fg-muted">{t("ai.struct.hint")}</p>
      {roots.length === 0 && (
        <p className="text-[13px] text-fg-muted">{t("ai.struct.nothingNew")}</p>
      )}
      {roots.map((r) => row(r, 0))}
      {proposal.skipped > 0 && (
        <p className="text-[12px] text-fg-muted">
          {t("ai.struct.skipped", { count: proposal.skipped })}
        </p>
      )}
      <p role="status" className="num text-[12px] text-fg-muted">
        {t("ai.struct.summary", { count: counts.create })}
        {counts.attach > 0 && ` · ${t("ai.struct.attach", { count: counts.attach })}`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy || counts.create + counts.attach === 0}
          className="h-11 min-w-0 flex-1 rounded-[13px] bg-fg text-[13.5px] font-semibold text-bg transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {t("ai.struct.createAll", { count: counts.create })}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy}
          className="h-11 shrink-0 rounded-[13px] border border-border-strong bg-surface px-4 text-[13px] font-medium transition-colors hover:bg-sunk disabled:opacity-50"
        >
          {t("ai.struct.discard")}
        </button>
      </div>
    </section>
  );
}
