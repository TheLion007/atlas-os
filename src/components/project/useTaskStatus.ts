"use client";

import { describeWriteError, useUpdateObject } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";
import { celebrate, useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import { useUi } from "../shell/ui-store";

/** What finishing a task is worth; a late one earns a little extra for being closed at last. */
export const POINTS = 10;
export const LATE_BONUS = 5;

type Status = "draft" | "active" | "done";

/**
 * Changes a task's status and gives the right feedback: finishing it is the app's small moment of
 * joy (sound, confetti from where you acted, the mascot cheers, a toast counts the points); any
 * other move is a quiet little drop. A failed write says so, with the error sound.
 */
export function useTaskStatus() {
  const { t } = useI18n();
  const update = useUpdateObject();
  const pushToast = useUi((s) => s.pushToast);

  const setStatus = (
    task: { id: string; title: string; due: string | null; status?: Status },
    to: Status,
    at: { x: number; y: number },
    today: string,
  ) => {
    if (task.status === to) return;
    update.mutate(
      { id: task.id, patch: { status: to } },
      {
        onSuccess: () => {
          if (to === "done") {
            const late = task.due !== null && task.due < today;
            celebrate(at);
            usePrefs.getState().addPoints(POINTS + (late ? LATE_BONUS : 0));
            pushToast(
              t("home.done", { title: task.title }),
              undefined,
              POINTS + (late ? LATE_BONUS : 0),
            );
          } else {
            playSound("drop");
            useFeedback.getState().react("happy");
          }
        },
        onError: (e) => {
          playSound("error");
          pushToast(describeWriteError(e, t));
        },
      },
    );
  };

  return { setStatus, pending: update.isPending };
}
