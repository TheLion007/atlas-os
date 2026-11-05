import { describe, expect, it } from "vitest";
import { SOUND_KINDS } from "./prefs";
import { soundPlan } from "./sound";

describe("the sounds are easy on the ears", () => {
  it("only ever use soft waves", () => {
    for (const profile of ["soft", "normal", "crystal"] as const)
      for (const kind of SOUND_KINDS)
        expect(["sine", "triangle"], `${profile}/${kind}`).toContain(soundPlan(kind, profile).wave);
  });

  it("keep the soft profile low: clicks and ticks 250–600 Hz, the finish arpeggio under 1 kHz", () => {
    for (const kind of ["click", "check", "drop"] as const)
      for (const n of soundPlan(kind).notes) {
        expect(n.freq).toBeGreaterThanOrEqual(250);
        expect(n.freq).toBeLessThanOrEqual(600);
      }
    for (const kind of ["done", "create"] as const)
      for (const n of soundPlan(kind).notes) expect(n.freq).toBeLessThanOrEqual(1000);
  });

  it("filters every sound between 2 and 3 kHz in the default and normal profiles", () => {
    expect(soundPlan("click", "soft").cutoff).toBeGreaterThanOrEqual(2000);
    expect(soundPlan("click", "soft").cutoff).toBeLessThanOrEqual(3000);
    expect(soundPlan("click", "normal").cutoff).toBeLessThanOrEqual(3000);
  });

  it("makes the crystal profile brighter, never harsher", () => {
    const soft = soundPlan("done", "soft").notes[2]!.freq;
    const crystal = soundPlan("done", "crystal").notes[2]!.freq;
    expect(crystal).toBeGreaterThan(soft);
    expect(soundPlan("done", "crystal").wave).not.toBe("square");
  });

  it("keeps the error low and softer than the rest", () => {
    const e = soundPlan("error");
    expect(Math.max(...e.notes.map((n) => n.freq))).toBeLessThan(250);
    expect(e.gain).toBeLessThan(1);
  });
});
