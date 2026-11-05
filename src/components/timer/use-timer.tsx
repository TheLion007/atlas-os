"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGraph } from "@/client/hooks";
import type { ApiObject } from "@/domain/api-types";
import { descendantsOf } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { celebrate, useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import { useTimer } from "@/lib/timer-store";
import { remainingMs, SESSION_POINTS, totalMs, type Completion } from "@/domain/timer";
import { useUi } from "../shell/ui-store";

/** The time left on the timer, refreshed while it runs. */
export function useRemaining(): number {
  const timer = useTimer((s) => s.timer);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [timer.running]);
  // A stale `now` can only overstate the time for a quarter of a second after a start.
  return Math.min(totalMs(timer), remainingMs(timer, now));
}

/** "25:00". */
export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** How much of the current countdown is left, 0–1. */
export function useFraction(): number {
  const left = useRemaining();
  const timer = useTimer((s) => s.timer);
  return Math.min(1, Math.max(0, left / totalMs(timer)));
}

export interface TimerTarget {
  projects: ApiObject[];
  projectId: string | null;
  /** Open tasks of the chosen project, most urgent first. */
  tasks: ApiObject[];
  /** The task title being focused on; "" means free work. */
  task: string;
}

const dueOf = (n: ApiObject): string => {
  const d = n.details?.due;
  return typeof d === "string" && d ? d : "9999";
};

/**
 * What the timer is aimed at: the chosen project and task, or by default the first project and its
 * most urgent open task. Nothing is stored until you choose or start.
 */
export function useTimerTarget(): TimerTarget {
  const graph = useGraph();
  const chosenProject = useTimer((s) => s.projectId);
  const chosenTask = useTimer((s) => s.task);
  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);
  const projects = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "project" && n.status !== "dropped")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [nodes],
  );
  const projectId = projects.find((p) => p.id === chosenProject)?.id ?? projects[0]?.id ?? null;
  const tasks = useMemo(() => {
    if (!projectId) return [];
    const inside = descendantsOf(projectId, edges);
    return nodes
      .filter(
        (n) =>
          n.type === "task" && inside.has(n.id) && (n.status === "draft" || n.status === "active"),
      )
      .sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  }, [nodes, edges, projectId]);
  const task =
    chosenTask !== null && (chosenTask === "" || tasks.some((x) => x.title === chosenTask))
      ? chosenTask
      : (tasks[0]?.title ?? "");
  return { projects, projectId, tasks, task };
}

/** What the end of a session or a break does to the person: sound, points, confetti, a word. */
export function useTimerEffects() {
  const { t } = useI18n();
  const pushToast = useUi((s) => s.pushToast);
  return useCallback(
    (done: Completion) => {
      if (!done) return;
      if (done.kind === "focus") {
        usePrefs.getState().addPoints(SESSION_POINTS);
        celebrate();
        pushToast(t("tm.sessionDone"), undefined, SESSION_POINTS);
      } else {
        playSound("create");
        useFeedback.getState().react("happy", t("tm.sayRested"));
        pushToast(t("tm.breakDone"));
      }
    },
    [pushToast, t],
  );
}

/** The timer's three buttons, with the right reaction to each (and to a forbidden one). */
export function useTimerActions() {
  const { t } = useI18n();
  const effects = useTimerEffects();
  const target = useTimerTarget();
  const store = useTimer;
  return {
    toggle: () => {
      const s = store.getState();
      if (s.timer.mode === "break") {
        playSound("error");
        useFeedback.getState().react("sleep", t("tm.sayBreak"));
        return;
      }
      playSound("click");
      const starting = !s.timer.running;
      if (starting) s.setProject(target.projectId, target.task);
      s.toggle(Date.now());
      if (starting) useFeedback.getState().react("happy", t("tm.sayGo"));
    },
    reset: () => {
      const s = store.getState();
      if (s.timer.mode === "break") {
        playSound("error");
        useFeedback.getState().react("sleep", t("tm.sayNoReset"));
        return;
      }
      playSound("click");
      s.resetTimer();
    },
    finish: () => {
      const s = store.getState();
      if (s.timer.mode === "break") {
        playSound("error");
        return;
      }
      effects(s.finish(Date.now()));
    },
  };
}

/** The timer's start/pause as one stable callback, for key handlers and the palette. */
export function useTimerToggle(): () => void {
  const actions = useTimerActions();
  const ref = useRef(actions.toggle);
  useEffect(() => {
    ref.current = actions.toggle;
  });
  return useCallback(() => ref.current(), []);
}

/**
 * Keeps the timer honest wherever you are in the app: it rehydrates the saved state, and ends a
 * session or a break when its time is up (also when the tab was asleep and just woke).
 */
export function TimerEngine() {
  const effects = useTimerEffects();
  useEffect(() => {
    void useTimer.persist.rehydrate();
  }, []);
  useEffect(() => {
    const run = () => effects(useTimer.getState().tick(Date.now()));
    const id = window.setInterval(run, 1000);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", run);
    };
  }, [effects]);
  return null;
}
