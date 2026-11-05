/**
 * The focus timer as a pure state machine over timestamps, never over a counter that a background
 * tab could slow down: the remaining time is always `endsAt - now`. A focus session is followed by
 * a mandatory break (5 min, or 10 after 50 min or more); the break ends by itself and hands the
 * timer back, stopped, ready for the next session.
 */

/** One finished focus session, as shown in the day's summary. */
export interface FocusSession {
  id: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Local `HH:MM`. */
  from: string;
  to: string;
  projectId: string | null;
  task: string | null;
  minutes: number;
}

export type TimerMode = "focus" | "break";

export interface TimerState {
  mode: TimerMode;
  /** The focus length chosen, in minutes. */
  minutes: number;
  running: boolean;
  /** When the running countdown reaches zero (ms since epoch); null while stopped. */
  endsAt: number | null;
  /** The time left while stopped (ms). */
  leftMs: number;
}

export type Completion =
  { kind: "focus"; startedAt: number; endedAt: number; minutes: number } | { kind: "break" } | null;

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 120;
export const PRESETS = [25, 50, 90] as const;
export const SESSION_POINTS = 15;

const MIN = 60_000;

export const breakMinutes = (focusMinutes: number): number => (focusMinutes >= 50 ? 10 : 5);

export const initialTimer = (minutes = 25): TimerState => ({
  mode: "focus",
  minutes,
  running: false,
  endsAt: null,
  leftMs: minutes * MIN,
});

export const totalMs = (s: TimerState): number =>
  (s.mode === "focus" ? s.minutes : breakMinutes(s.minutes)) * MIN;

export function remainingMs(s: TimerState, now: number): number {
  return s.running && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.leftMs;
}

export function start(s: TimerState, now: number): TimerState {
  if (s.running) return s;
  return { ...s, running: true, endsAt: now + s.leftMs };
}

export function pause(s: TimerState, now: number): TimerState {
  if (!s.running) return s;
  return { ...s, running: false, endsAt: null, leftMs: remainingMs(s, now) };
}

/** Back to the full length of a stopped focus session. A break cannot be reset. */
export function reset(s: TimerState): TimerState {
  if (s.mode === "break") return s;
  return { ...s, running: false, endsAt: null, leftMs: s.minutes * MIN };
}

/** A new focus length; only between sessions. */
export function setMinutes(s: TimerState, minutes: number): TimerState {
  if (s.mode === "break" || s.running) return s;
  const m = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
  return { ...s, minutes: m, leftMs: m * MIN };
}

function startBreak(s: TimerState, now: number): TimerState {
  const ms = breakMinutes(s.minutes) * MIN;
  return { ...s, mode: "break", running: true, endsAt: now + ms, leftMs: ms };
}

/** What a finished focus session was worth: the minutes actually spent, at least one. */
function focusCompletion(s: TimerState, now: number, spentMs: number): Completion {
  return {
    kind: "focus",
    startedAt: now - spentMs,
    endedAt: now,
    minutes: Math.max(1, Math.round(spentMs / MIN)),
  };
}

/** Advances the timer to `now`: when the countdown has run out, the session or the break ends. */
export function tick(s: TimerState, now: number): { state: TimerState; done: Completion } {
  if (!s.running || s.endsAt === null || now < s.endsAt) return { state: s, done: null };
  if (s.mode === "focus")
    return {
      state: startBreak(s, now),
      done: focusCompletion(s, now, s.minutes * MIN),
    };
  return { state: { ...initialTimer(s.minutes) }, done: { kind: "break" } };
}

/**
 * Ends the focus session now. What was spent counts (under a minute counts for nothing and just
 * resets); a break cannot be cut short.
 */
export function finishNow(s: TimerState, now: number): { state: TimerState; done: Completion } {
  if (s.mode === "break") return { state: s, done: null };
  const spent = totalMs(s) - remainingMs(s, now);
  if (spent < MIN) return { state: reset(s), done: null };
  return { state: startBreak(s, now), done: focusCompletion(s, now, spent) };
}
