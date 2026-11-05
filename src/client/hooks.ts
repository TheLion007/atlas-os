"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type { GraphPayload, NewRelation, ObjectPatch } from "@/domain/api-types";
import { EXAMPLE_TAG } from "@/domain/creation";
import type { CreateEdgeInput, CreateObjectInput } from "@/domain/schemas";
import type { TFunction } from "@/i18n";
import { buildCommandCenter, type CommandCenterModel } from "@/domain/command-center";
import type { DocumentKind, ObjectType, ScenarioVariant } from "@/domain/enums";
import { buildFinanceModel, type FinanceModel } from "@/domain/finance";
import { DataSourceError } from "./data-source";
import { importDocument } from "./import-documents";
import { useSource } from "./provider";

/*
 * Data hooks. Each is a thin query over the AtlasDataSource interface: the same code serves the
 * real API and the dev fixtures. Derived values are computed here with the pure engine and
 * are never written back.
 */

export function useGraph() {
  const source = useSource();
  return useQuery({
    queryKey: ["graph", source?.mode],
    queryFn: () => (source as NonNullable<typeof source>).graph(),
    enabled: !!source,
  });
}

export function useObject(id: string | null) {
  const source = useSource();
  return useQuery({
    queryKey: ["object", source?.mode, id],
    queryFn: () => (source as NonNullable<typeof source>).object(id as string),
    enabled: !!source && id !== null,
  });
}

export function useActivity(limit = 30) {
  const source = useSource();
  return useQuery({
    queryKey: ["activity", source?.mode, limit],
    queryFn: () => (source as NonNullable<typeof source>).activity(limit),
    enabled: !!source,
  });
}

export function useProgress(days = 120) {
  const source = useSource();
  return useQuery({
    queryKey: ["progress", source?.mode, days],
    queryFn: () => (source as NonNullable<typeof source>).progress(days),
    enabled: !!source,
  });
}

export function useSettings() {
  const source = useSource();
  return useQuery({
    queryKey: ["settings", source?.mode],
    queryFn: () => (source as NonNullable<typeof source>).settings(),
    enabled: !!source,
  });
}

export type LoadState = "loading" | "error" | "ready";

function combine(...queries: UseQueryResult<unknown, Error>[]): {
  state: LoadState;
  error: Error | null;
  refetch: () => void;
} {
  const failed = queries.find((q) => q.isError);
  return {
    state: failed ? "error" : queries.some((q) => q.isPending) ? "loading" : "ready",
    error: failed?.error ?? null,
    refetch: () => queries.forEach((q) => void q.refetch()),
  };
}

/** Human wording for a failed load. Never shows internals. */
export function describeError(
  error: Error | null,
  t: TFunction,
): { title: string; message: string } {
  if (error instanceof DataSourceError) {
    if (error.status === 401)
      return { title: t("error.notSignedIn"), message: t("error.notSignedInMessage") };
    if (error.status === 503)
      return { title: t("error.notConnected"), message: t("error.notConnectedMessage") };
    if (error.status === 0)
      return { title: t("error.offline"), message: t("error.offlineMessage") };
    return { title: t("error.loadFailed"), message: error.message };
  }
  return { title: t("error.loadFailed"), message: t("error.genericMessage") };
}

/** Wording for a write that failed: what to do about it, never the server's internals. */
export function describeWriteError(error: unknown, t: TFunction): string {
  if (error instanceof DataSourceError) {
    if (error.status === 400) return t("error.invalid");
    if (error.status === 409) return t("error.conflict");
    if (error.status === 404) return t("error.objectGone");
    if (error.status === 0) return t("error.offlineMessage");
  }
  return t("error.saveFailed");
}

/*
 * Writes. Every write goes through the AtlasDataSource (the API, or the dev fixtures with the
 * same rules) and then refreshes what the lenses read: the graph, single objects and activity.
 * The lenses never hold a copy of their own, so a new object shows up everywhere at once.
 */
function useWriter() {
  const source = useSource();
  // The demo source loads asynchronously; a write attempted before then fails as "not connected".
  return () => {
    if (!source) throw new DataSourceError(503, "unavailable", "Data source not ready.");
    return source;
  };
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [] });
}

export function useCreateObject() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { input: CreateObjectInput; relations?: NewRelation[] }) =>
      need().createObject(v.input, v.relations),
    onSuccess: refresh,
  });
}

export function useUpdateObject() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { id: string; patch: ObjectPatch }) => need().updateObject(v.id, v.patch),
    onSuccess: refresh,
  });
}

export function useConvertObjectType() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: { id: string; type: ObjectType }) => need().convertObjectType(v.id, v.type),
    onSuccess: refresh,
  });
}

export function useDeleteObject() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => need().deleteObject(id),
    onSuccess: refresh,
  });
}

export function useCreateEdge() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: CreateEdgeInput) => need().createEdge(input),
    onSuccess: refresh,
  });
}

export function useDeleteEdge() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => need().deleteEdge(id),
    onSuccess: refresh,
  });
}

/** Deletes every object tagged as example data. The user's own objects are untouched. */
export function useRemoveExamples() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async () => {
      const source = need();
      const { nodes } = await source.graph();
      const examples = nodes.filter((n) => n.tags.includes(EXAMPLE_TAG));
      for (const n of examples) await source.deleteObject(n.id);
      return examples.length;
    },
    onSuccess: refresh,
  });
}

/** The Command Center's model for the chosen scenario, or the state explaining why not. */
export function useCommandCenter(scenario: ScenarioVariant) {
  const source = useSource();
  const graph = useGraph();
  const settings = useSettings();
  const status = combine(graph as UseQueryResult<GraphPayload, Error>, settings);

  const model: CommandCenterModel | null = useMemo(() => {
    if (!source || !graph.data || !settings.data) return null;
    return buildCommandCenter({
      today: source.today(),
      scenario,
      baseCurrency: settings.data.baseCurrency,
      fxRates: settings.data.fxRates,
      nodes: graph.data.nodes,
      edges: graph.data.edges,
    });
  }, [source, graph.data, settings.data, scenario]);

  return {
    ...status,
    state: status.state === "ready" && !model ? ("loading" as const) : status.state,
    model,
    today: source?.today() ?? null,
    settings: settings.data ?? null,
  };
}

/** Finance, derived for the chosen scenario from the shared graph and settings. */
export function useFinance(scenario: ScenarioVariant) {
  const source = useSource();
  const graph = useGraph();
  const settings = useSettings();
  const status = combine(graph as UseQueryResult<GraphPayload, Error>, settings);
  const model: FinanceModel | null = useMemo(() => {
    if (!source || !graph.data || !settings.data) return null;
    return buildFinanceModel({
      today: source.today(),
      scenario,
      baseCurrency: settings.data.baseCurrency,
      fxRates: settings.data.fxRates,
      nodes: graph.data.nodes,
      edges: graph.data.edges,
    });
  }, [source, graph.data, settings.data, scenario]);
  return {
    ...status,
    state: status.state === "ready" && !model ? ("loading" as const) : status.state,
    model,
    nodes: graph.data?.nodes ?? [],
    edges: graph.data?.edges ?? [],
    today: source?.today() ?? null,
    settings: settings.data ?? null,
  };
}

/** The file store of the current data source (for previews and downloads). */
export function useFiles() {
  const source = useSource();
  return {
    ready: !!source,
    url: (storagePath: string | null): string | null =>
      source && storagePath ? source.fileUrl(storagePath) : null,
  };
}

/** Imports files as documents, one after the other; reports each file's outcome. */
export function useImportDocuments() {
  const need = useWriter();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (v: {
      files: File[];
      projectId?: string | null;
      kind?: DocumentKind;
      tags?: string[];
    }) => {
      const source = need();
      const results: { name: string; id?: string; error?: unknown }[] = [];
      for (const file of v.files) {
        try {
          const doc = await importDocument(source, file, {
            projectId: v.projectId,
            kind: v.kind,
            tags: v.tags,
            now: source.now(),
          });
          results.push({ name: file.name, id: doc.id });
        } catch (error) {
          results.push({ name: file.name, error });
        }
      }
      return results;
    },
    onSuccess: refresh,
  });
}
