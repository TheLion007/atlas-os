"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createApiSource } from "./api-source";
import { DataSourceError, type AtlasDataSource } from "./data-source";

const SourceContext = createContext<AtlasDataSource | null>(null);

/** The data source, or `null` while the fixture module (dev only) is still loading. */
export function useSource(): AtlasDataSource | null {
  return useContext(SourceContext);
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Client errors (401, 404, 422) will not fix themselves; only transient failures retry.
        retry: (count, error) =>
          !(error instanceof DataSourceError && error.status >= 400 && error.status < 500) &&
          count < 2,
      },
    },
  });
}

interface AtlasProviderProps {
  /** "demo" only ever comes from a development session (see server/session.ts). */
  mode: "authenticated" | "demo";
  children: ReactNode;
  /** Test seams. */
  source?: AtlasDataSource;
  queryClient?: QueryClient;
}

/**
 * Supplies the query cache and the data source. The fixture source is imported dynamically and
 * only behind a `NODE_ENV` check, so the fixture data is dead code in a production build.
 */
export function AtlasProvider({
  mode,
  children,
  source: injected,
  queryClient,
}: AtlasProviderProps) {
  const [ownClient] = useState(makeQueryClient);
  const client = queryClient ?? ownClient;
  const [apiSource] = useState(createApiSource);
  const [fixtureSource, setFixtureSource] = useState<AtlasDataSource | null>(null);

  // Fixtures are only ever loaded for a demo session, and never in production.
  const wantsFixtures = mode === "demo" && process.env.NODE_ENV !== "production" && !injected;

  useEffect(() => {
    if (!wantsFixtures) return;
    let cancelled = false;
    void Promise.all([
      import("@/seed/fixtures"),
      import("@/seed/neutral-fr"),
      import("./fixture-source"),
    ]).then(([{ buildFixtureData }, { neutralSeed }, { createFixtureSource }]) => {
      // The public demo is the neutral French workspace, never anyone's own data.
      if (!cancelled) setFixtureSource(createFixtureSource(buildFixtureData(neutralSeed())));
    });
    return () => {
      cancelled = true;
    };
  }, [wantsFixtures]);

  const source = injected ?? (wantsFixtures ? fixtureSource : apiSource);

  return (
    <QueryClientProvider client={client}>
      <SourceContext.Provider value={source}>{children}</SourceContext.Provider>
    </QueryClientProvider>
  );
}
