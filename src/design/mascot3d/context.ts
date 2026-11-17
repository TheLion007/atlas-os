import type { MascotMood } from "@/lib/feedback/celebrate";
import type { PipExpression } from "./expressions";

/** What Pip can read from the app. Times are `Date.now()` milliseconds. */
export interface Signals {
  /** The satisfaction layer: a finished task makes him cheer, a dropped card makes him happy. */
  mood: MascotMood;
  now: number;
  errorUntil: number;
  greetUntil: number;
  dizzyUntil: number;
  /** The AI assistant is working on an answer. */
  thinking: boolean;
  /** A focus session is running. */
  timerRunning: boolean;
  offline: boolean;
  /** Nobody has touched the keyboard or the mouse for a while. */
  idle: boolean;
}

/** Why Pip looks the way he does: the dock turns it into a few words. */
export type Reason =
  | "celebrate"
  | "error"
  | "greeting"
  | "dizzy"
  | "thinking"
  | "working"
  | "offline"
  | "idle-sleep"
  | "calm";

export interface Reading {
  expression: PipExpression;
  reason: Reason;
}

/**
 * Pip's judgement, in order of importance: a win outranks everything, then a problem, then the
 * welcome, then being shaken about; then what he is helping with (the assistant, a session); and
 * last, whether he is left alone (offline, or nobody around) and falls asleep.
 */
export function readContext(s: Signals): Reading {
  if (s.mood === "cheer") return { expression: "dancing", reason: "celebrate" };
  if (s.mood === "happy") return { expression: "happy", reason: "celebrate" };
  if (s.now < s.errorUntil) return { expression: "error", reason: "error" };
  if (s.now < s.greetUntil) return { expression: "greeting", reason: "greeting" };
  if (s.now < s.dizzyUntil) return { expression: "dizzy", reason: "dizzy" };
  if (s.thinking) return { expression: "thinking", reason: "thinking" };
  if (s.timerRunning) return { expression: "working", reason: "working" };
  if (s.offline) return { expression: "sleeping", reason: "offline" };
  if (s.idle || s.mood === "sleep") return { expression: "sleeping", reason: "idle-sleep" };
  return { expression: "idle", reason: "calm" };
}
