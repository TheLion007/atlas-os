"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { planDeletion, type DeletionPlan } from "@/domain/deletion";
import { useI18n } from "@/i18n/I18nProvider";
import { POINTS_PER_TASK, useAssistantUndo } from "@/lib/assistant-undo";
import { UNDO_DELAY_MS, useDeletion } from "@/lib/deletion-store";
import { playSound } from "@/lib/feedback/sound";
import { usePrefs } from "@/lib/feedback/prefs";
import { usePeek } from "@/lib/url-state";
import { hrefKeepingState } from "@/components/shell/nav";
import { useUi } from "@/components/shell/ui-store";
import type { AtlasDataSource } from "./data-source";
import { describeWriteError } from "./hooks";
import { useSource } from "./provider";

/** One timer per deletion that can still be undone; when it rings the deletion becomes final. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Makes a deletion final: the objects go for good and so do the bytes of their documents. */
async function finalize(source: AtlasDataSource, key: number) {
  const entry = useDeletion.getState().pending.find((p) => p.key === key);
  timers.delete(key);
  if (!entry) return;
  useDeletion.getState().drop(key);
  try {
    await source.purgeMany({ ids: entry.receipt.objectIds });
    // The in-memory demo keeps its files apart; the database already freed them with the rows.
    if (source.mode === "fixtures")
      for (const d of entry.receipt.documents)
        if (d.storagePath) await source.deleteFile(d.storagePath).catch(() => undefined);
  } catch {
    /* it stays soft-deleted: a later start frees the documents (see `staleDocuments`) */
  }
}

/**
 * Deleting from anywhere: asks for confirmation when the object holds other things (saying
 * exactly what goes, with numbers), deletes at once when it is alone, shows "Deleted · Undo" for a
 * few seconds, and only then makes the deletion final. Every object type goes through here.
 */
export function useObjectDeletion() {
  const source = useSource();
  const client = useQueryClient();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [peekId, setPeek] = usePeek();
  const pushToast = useUi((s) => s.pushToast);

  const refresh = () => client.invalidateQueries({ queryKey: [] });

  const leaveDeleted = (ids: string[]) => {
    const gone = new Set(ids);
    if (peekId && gone.has(peekId)) setPeek(null);
    const m = /^\/objects\/([^/?#]+)/.exec(pathname);
    if (m && gone.has(decodeURIComponent(m[1]!))) router.push(hrefKeepingState("/", params));
  };

  const perform = async (plan: DeletionPlan, mode: "all" | "keep") => {
    if (!source) return;
    const keep = mode === "keep" && plan.canKeepChildren;
    try {
      const receipt = await source.deleteMany({
        ids: keep ? plan.keep.ids : plan.all,
        reattach: keep ? plan.keep.reattach : [],
      });
      // Points earned when the assistant created these are taken back, as when it is undone.
      const undo = useAssistantUndo.getState();
      const assistantIds = undo.batch
        ? receipt.objectIds.filter((id) => undo.batch!.objectIds.includes(id))
        : [];
      if (assistantIds.length > 0) {
        undo.forget(assistantIds);
        usePrefs.getState().addPoints(-assistantIds.length * POINTS_PER_TASK);
      }
      const entry = useDeletion.getState().push({
        title: plan.root.title,
        type: plan.root.type,
        count: receipt.objectIds.length,
        receipt,
        hasDocuments: receipt.documents.length > 0,
        assistantIds,
      });
      timers.set(
        entry.key,
        setTimeout(() => void finalize(source, entry.key), UNDO_DELAY_MS),
      );
      playSound("click");
      await refresh();
      leaveDeleted(receipt.objectIds);
    } catch (e) {
      playSound("error");
      pushToast(describeWriteError(e, t));
    }
  };

  /** Starts a deletion: at once when the object is alone, after a confirmation when it is not. */
  const request = async (id: string) => {
    if (!source) return;
    try {
      const { nodes, edges } = await source.graph();
      const plan = planDeletion(nodes, edges, id);
      if (!plan) return;
      if (plan.extra === 0) await perform(plan, "all");
      else useDeletion.getState().askConfirm(id);
    } catch (e) {
      playSound("error");
      pushToast(describeWriteError(e, t));
    }
  };

  const undo = async (key: number) => {
    if (!source) return;
    const entry = useDeletion.getState().pending.find((p) => p.key === key);
    if (!entry) return;
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
    try {
      await source.restoreMany(entry.receipt);
      useDeletion.getState().drop(key);
      if (entry.assistantIds.length > 0) {
        const back = useAssistantUndo.getState().readd(entry.assistantIds);
        usePrefs.getState().addPoints(back * POINTS_PER_TASK);
      }
      playSound("click");
      pushToast(t("rm.undone", { title: entry.title }));
    } catch {
      useDeletion.getState().drop(key);
      playSound("error");
      pushToast(t("rm.undoFailed"));
    } finally {
      await refresh();
    }
  };

  /** Makes the oldest pending deletions final right away (the banner was dismissed). */
  const dismiss = (key: number) => {
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    if (source) void finalize(source, key);
  };

  /** At start: frees documents deleted in an earlier session whose undo delay was cut short. */
  const freeStale = () => {
    if (source?.mode === "api")
      void source.purgeMany({ staleDocuments: true }).catch(() => undefined);
  };

  return { request, perform, undo, dismiss, freeStale, ready: source !== null };
}
