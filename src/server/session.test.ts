import { afterEach, describe, expect, it, vi } from "vitest";
import { setContextForTests } from "./context";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-test-user": "abc" }) }));

import { DEMO_OWNER, fixturesEnabled, getSession } from "./session";

afterEach(() => {
  vi.unstubAllEnvs();
  setContextForTests(undefined);
});

describe("session boundary", () => {
  it("has no session when nobody is authenticated (deny by default)", async () => {
    setContextForTests({ getDb: () => ({}) as never, authenticate: async () => null });
    expect(await getSession()).toBeNull();
  });

  it("returns the authenticated owner from the request headers", async () => {
    setContextForTests({
      getDb: () => ({}) as never,
      authenticate: async (req) => req.headers.get("x-test-user"),
    });
    expect(await getSession()).toEqual({ ownerId: "abc", mode: "authenticated" });
  });

  describe("fixtures (demo) mode", () => {
    it("is off unless explicitly enabled", () => {
      vi.stubEnv("NEXT_PUBLIC_ATLAS_FIXTURES", "");
      expect(fixturesEnabled()).toBe(false);
    });

    it("gives a demo session when enabled outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_ATLAS_FIXTURES", "1");
      expect(fixturesEnabled()).toBe(true);
      expect(await getSession()).toEqual({ ownerId: DEMO_OWNER, mode: "demo" });
    });

    it("can never be enabled in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PUBLIC_ATLAS_FIXTURES", "1");
      setContextForTests({ getDb: () => ({}) as never, authenticate: async () => null });
      expect(fixturesEnabled()).toBe(false);
      expect(await getSession()).toBeNull();
    });
  });
});
