import { describe, expect, it } from "vitest";
import { readContext, type Signals } from "./context";

const calm: Signals = {
  mood: "idle",
  now: 1000,
  errorUntil: 0,
  greetUntil: 0,
  dizzyUntil: 0,
  thinking: false,
  timerRunning: false,
  offline: false,
  idle: false,
};
const read = (patch: Partial<Signals>) => readContext({ ...calm, ...patch });

describe("what Pip makes of the app", () => {
  it("is calm when nothing is happening", () => {
    expect(read({})).toEqual({ expression: "idle", reason: "calm" });
  });

  it("sleeps when offline, and when left alone", () => {
    expect(read({ offline: true })).toEqual({ expression: "sleeping", reason: "offline" });
    expect(read({ idle: true })).toEqual({ expression: "sleeping", reason: "idle-sleep" });
  });

  it("greets on arrival, only while the welcome lasts", () => {
    expect(read({ greetUntil: 4000 }).expression).toBe("greeting");
    expect(read({ greetUntil: 900 }).expression).toBe("idle");
  });

  it("looks worried at an error, then recovers by itself", () => {
    expect(read({ errorUntil: 5000 }).expression).toBe("error");
    expect(read({ errorUntil: 999 }).expression).toBe("idle");
  });

  it("thinks while the assistant works and works while a session runs", () => {
    expect(read({ thinking: true }).expression).toBe("thinking");
    expect(read({ timerRunning: true }).expression).toBe("working");
    expect(read({ thinking: true, timerRunning: true }).expression).toBe("thinking");
  });

  it("gets dizzy when shaken about", () => {
    expect(read({ dizzyUntil: 3000 }).expression).toBe("dizzy");
  });

  it("lets a win outrank everything else", () => {
    expect(read({ mood: "cheer", errorUntil: 5000, offline: true }).expression).toBe("dancing");
    expect(read({ mood: "happy", thinking: true }).expression).toBe("happy");
  });

  it("puts a problem before the welcome, and the welcome before sleep", () => {
    expect(read({ errorUntil: 5000, greetUntil: 5000 }).expression).toBe("error");
    expect(read({ greetUntil: 5000, offline: true }).expression).toBe("greeting");
  });

  it("keeps working while offline", () => {
    expect(read({ offline: true, timerRunning: true }).expression).toBe("working");
  });
});
