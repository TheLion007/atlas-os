// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphPayload } from "@/domain/api-types";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { createApiSource } from "./api-source";
import { DataSourceError, type AtlasDataSource } from "./data-source";
import { createFixtureSource } from "./fixture-source";
import { describeError, useCommandCenter } from "./hooks";
import { i18nCtx } from "../../tests/support/i18n";
import { AtlasProvider, useSource } from "./provider";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const en = i18nCtx("en");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api source", () => {
  it("asks the real endpoints, with details for the graph and relations for one object", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const source = createApiSource();
    await source.graph();
    await source.object("a b");
    await source.activity(5);
    await source.settings();
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "/api/graph?details=true",
      "/api/objects/a%20b?expand=relations",
      "/api/activity?limit=5",
      "/api/settings",
    ]);
  });

  it("turns the API's error body into a typed error", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code: "unauthorized", message: "Authentication required." } }, 401),
    );
    await expect(createApiSource().graph()).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Authentication required.",
    });
  });

  it("copes with a non-JSON error and with the network being down", async () => {
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    await expect(createApiSource().settings()).rejects.toMatchObject({ status: 500 });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("failed to fetch");
    });
    await expect(createApiSource().settings()).rejects.toMatchObject({
      status: 0,
      code: "network",
    });
  });

  it("reads today from the local clock", () => {
    expect(createApiSource().today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("fixture source", () => {
  const source = createFixtureSource(data);

  it("implements the same contract: a graph, and objects with relations grouped by verb", async () => {
    const graph = await source.graph();
    expect(graph.nodes.length).toBeGreaterThan(40);
    const marina = await source.object(seedId("prop_marina"));
    expect(marina.relations.located_at.outgoing[0]?.object.title).toBe("Dorsel Marina");
    expect(marina.relations.estimates.incoming.map((r) => r.object.title)).toContain(
      "Marina 1BR asking price",
    );
    expect(marina.relations.funded_by.outgoing[0]?.object.title).toBe("Capital on hand");
  });

  it("answers 404 for an unknown object, like the API", async () => {
    await expect(source.object("nope")).rejects.toBeInstanceOf(DataSourceError);
    await expect(source.object("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("limits activity and pins today so the demo is stable", async () => {
    expect(await source.activity(3)).toHaveLength(3);
    expect(source.today()).toBe("2026-09-21");
  });
});

function wrap(source: AtlasDataSource) {
  // No retries: the production client retries transient failures with backoff, which tests skip.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AtlasProvider mode="demo" source={source} queryClient={queryClient}>
        {children}
      </AtlasProvider>
    );
  };
}

describe("AtlasProvider", () => {
  it("loads fixtures for a demo session outside production", async () => {
    const { result } = renderHook(() => useSource(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AtlasProvider mode="demo">{children}</AtlasProvider>
      ),
    });
    await waitFor(() => expect(result.current?.mode).toBe("fixtures"));
  });

  it("never serves fixtures in production, even if a demo session slips through", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { result } = renderHook(() => useSource(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AtlasProvider mode="demo">{children}</AtlasProvider>
      ),
    });
    await waitFor(() => expect(result.current?.mode).toBe("api"));
  });

  it("uses the real API for an authenticated session", () => {
    const { result } = renderHook(() => useSource(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AtlasProvider mode="authenticated">{children}</AtlasProvider>
      ),
    });
    expect(result.current?.mode).toBe("api");
  });
});

describe("useCommandCenter", () => {
  it("goes from loading to a derived model", async () => {
    const { result } = renderHook(() => useCommandCenter("base"), {
      wrapper: wrap(createFixtureSource(data)),
    });
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.model?.capital.actual).toBe(109400);
    expect(result.current.today).toBe("2026-09-21");
    expect(result.current.model?.focus).toHaveLength(3);
  });

  it("surfaces a failed load instead of an empty dashboard", async () => {
    const failing: AtlasDataSource = {
      ...createFixtureSource(data),
      graph: async () => {
        throw new DataSourceError(503, "unavailable", "The database is not configured.");
      },
    };
    const { result } = renderHook(() => useCommandCenter("base"), { wrapper: wrap(failing) });
    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.model).toBeNull();
    expect(describeError(result.current.error, en.t).title).toBe("Data is not connected");
  });

  it("is an empty model (not an error) for a brand-new owner", async () => {
    const empty: AtlasDataSource = {
      ...createFixtureSource(data),
      graph: async (): Promise<GraphPayload> => ({ nodes: [], edges: [] }),
      settings: async () => ({
        baseCurrency: null,
        activeScenario: "base",
        timelineStart: null,
        timelineEnd: null,
        fxRates: [],
      }),
    };
    const { result } = renderHook(() => useCommandCenter("base"), { wrapper: wrap(empty) });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.model?.isEmpty).toBe(true);
  });

  it("re-derives when the scenario changes without refetching", async () => {
    const source = createFixtureSource(data);
    const spy = vi.spyOn(source, "graph");
    const client = new QueryClient();
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AtlasProvider mode="demo" source={source}>
          {children}
        </AtlasProvider>
      </QueryClientProvider>
    );
    const { result, rerender } = renderHook(({ s }) => useCommandCenter(s), {
      wrapper: Wrapper,
      initialProps: { s: "base" as const } as { s: "base" | "conservative" },
    });
    await waitFor(() => expect(result.current.state).toBe("ready"));
    rerender({ s: "conservative" });
    expect(result.current.model).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("describeError", () => {
  it.each([
    [new DataSourceError(401, "unauthorized", "x"), "Not signed in"],
    [new DataSourceError(503, "unavailable", "x"), "Data is not connected"],
    [new DataSourceError(0, "network", "x"), "Offline"],
    [new DataSourceError(500, "internal", "Boom"), "Could not load your data"],
    [new Error("weird"), "Could not load your data"],
    [null, "Could not load your data"],
  ])("words %#", (error, title) => {
    expect(describeError(error, en.t).title).toBe(title);
  });

  it("never leaks a raw exception message for unknown errors", () => {
    expect(describeError(new Error("SELECT * FROM secrets"), en.t).message).not.toContain("SELECT");
  });
});
