"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  finishNow,
  initialTimer,
  pause,
  reset,
  setMinutes,
  start,
  tick,
  type Completion,
  type FocusSession,
  type TimerState,
} from "@/domain/timer";

export const TIMER_KEY = "atlas-timer";
const KEEP = 600;

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const dayOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface TimerStore {
  timer: TimerState;
  projectId: string | null;
  /** The task being worked on (its title), or null for free work. */
  task: string | null;
  sessions: FocusSession[];
  /** Breaks lived through to the end, per day, so "pauses respectées" is honest. */
  breaks: Record<string, number>;

  toggle: (now: number) => void;
  resetTimer: () => void;
  finish: (now: number) => Completion;
  tick: (now: number) => Completion;
  setMinutes: (minutes: number) => void;
  setProject: (projectId: string | null, task?: string | null) => void;
  setTask: (task: string | null) => void;
}

function record(s: TimerStore, done: Completion): Partial<TimerStore> {
  if (!done) return {};
  if (done.kind === "break") {
    const day = dayOf(Date.now());
    return { breaks: { ...s.breaks, [day]: (s.breaks[day] ?? 0) + 1 } };
  }
  const session: FocusSession = {
    id: `${done.endedAt}`,
    day: dayOf(done.endedAt),
    from: hhmm(done.startedAt),
    to: hhmm(done.endedAt),
    projectId: s.projectId,
    task: s.task,
    minutes: done.minutes,
  };
  return { sessions: [...s.sessions, session].slice(-KEEP) };
}

const storage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
});

export const useTimer = create<TimerStore>()(
  persist(
    (set, get) => ({
      timer: initialTimer(25),
      projectId: null,
      task: null,
      sessions: [],
      breaks: {},

      toggle: (now) => {
        const { timer } = get();
        if (timer.mode === "break") return;
        set({ timer: timer.running ? pause(timer, now) : start(timer, now) });
      },
      resetTimer: () => set((s) => ({ timer: reset(s.timer) })),
      finish: (now) => {
        const r = finishNow(get().timer, now);
        set((s) => ({ timer: r.state, ...record(s, r.done) }));
        return r.done;
      },
      tick: (now) => {
        const r = tick(get().timer, now);
        if (r.state !== get().timer) set((s) => ({ timer: r.state, ...record(s, r.done) }));
        return r.done;
      },
      setMinutes: (minutes) => set((s) => ({ timer: setMinutes(s.timer, minutes) })),
      setProject: (projectId, task = null) => set({ projectId, task }),
      setTask: (task) => set({ task }),
    }),
    {
      name: TIMER_KEY,
      version: 1,
      storage,
      // Hydrated in an effect (like the other preferences), so the first render matches the server's.
      skipHydration: true,
      partialize: (s) => ({
        timer: s.timer,
        projectId: s.projectId,
        task: s.task,
        sessions: s.sessions,
        breaks: s.breaks,
      }),
    },
  ),
);
