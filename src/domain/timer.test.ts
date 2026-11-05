import { describe, expect, it } from "vitest";
import {
  breakMinutes,
  finishNow,
  initialTimer,
  pause,
  remainingMs,
  reset,
  setMinutes,
  start,
  tick,
} from "./timer";

const T0 = 1_000_000;
const MIN = 60_000;

describe("focus timer", () => {
  it("counts down from timestamps, so a slow tab loses nothing", () => {
    const s = start(initialTimer(25), T0);
    expect(remainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(tick(s, T0 + 24 * MIN).done).toBeNull();
  });

  it("pauses and resumes with what was left", () => {
    const paused = pause(start(initialTimer(25), T0), T0 + 5 * MIN);
    expect(paused.leftMs).toBe(20 * MIN);
    expect(remainingMs(start(paused, T0 + 99 * MIN), T0 + 100 * MIN)).toBe(19 * MIN);
  });

  it("ends a session into a mandatory break, then hands back a stopped timer", () => {
    const s = start(initialTimer(25), T0);
    const a = tick(s, T0 + 25 * MIN);
    expect(a.done).toEqual({ kind: "focus", startedAt: T0, endedAt: T0 + 25 * MIN, minutes: 25 });
    expect(a.state).toMatchObject({ mode: "break", running: true });
    expect(remainingMs(a.state, T0 + 25 * MIN)).toBe(5 * MIN);
    const b = tick(a.state, T0 + 30 * MIN);
    expect(b.done).toEqual({ kind: "break" });
    expect(b.state).toMatchObject({ mode: "focus", running: false, leftMs: 25 * MIN });
  });

  it("gives a longer break after a long session", () => {
    expect(breakMinutes(25)).toBe(5);
    expect(breakMinutes(50)).toBe(10);
    expect(breakMinutes(90)).toBe(10);
  });

  it("finishing early counts the time actually spent, and under a minute counts for nothing", () => {
    const s = start(initialTimer(50), T0);
    const r = finishNow(s, T0 + 12 * MIN);
    expect(r.done).toMatchObject({ kind: "focus", minutes: 12 });
    expect(r.state.mode).toBe("break");
    const none = finishNow(s, T0 + 20_000);
    expect(none.done).toBeNull();
    expect(none.state).toMatchObject({ mode: "focus", running: false, leftMs: 50 * MIN });
  });

  it("only changes the length between sessions, within bounds", () => {
    expect(setMinutes(initialTimer(25), 500).minutes).toBe(120);
    expect(setMinutes(initialTimer(25), 1).minutes).toBe(5);
    const running = start(initialTimer(25), T0);
    expect(setMinutes(running, 50)).toBe(running);
    const brk = tick(running, T0 + 25 * MIN).state;
    expect(reset(brk)).toBe(brk);
    expect(setMinutes(brk, 50)).toBe(brk);
  });
});
