import { localIsoDate } from "@/lib/today";
import {
  DataSourceError,
  MAX_FILE_BYTES,
  type AtlasDataSource,
  type StoredFile,
} from "./data-source";

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new DataSourceError(0, "network", "Could not reach the server.");
  }
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;

  let code = "error";
  let message = `The server answered ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    /* keep the generic message */
  }
  throw new DataSourceError(res.status, code, message);
}

/** The real data source: the Atlas OS HTTP API. */
export function createApiSource(): AtlasDataSource {
  return {
    mode: "api",
    today: () => localIsoDate(),
    now: () => new Date(),
    graph: () => request("/api/graph?details=true"),
    object: (id) => request(`/api/objects/${encodeURIComponent(id)}?expand=relations`),
    activity: (limit = 30) => request(`/api/activity?limit=${limit}`),
    progress: (days = 120) => request(`/api/progress?days=${days}`),
    settings: () => request("/api/settings"),
    createObject: (input, relations = []) =>
      request("/api/objects", { method: "POST", body: { ...input, relations } }),
    updateObject: (id, patch) =>
      request(`/api/objects/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }),
    convertObjectType: (id, type) =>
      request(`/api/objects/${encodeURIComponent(id)}/convert`, { method: "POST", body: { type } }),
    deleteObject: (id) => request(`/api/objects/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deleteMany: ({ ids, reattach = [] }) =>
      request("/api/objects/delete-many", { method: "POST", body: { ids, reattach } }),
    restoreMany: async (receipt) => {
      await request("/api/objects/restore-many", {
        method: "POST",
        body: {
          objectIds: receipt.objectIds,
          edgeIds: receipt.edgeIds,
          addedEdgeIds: receipt.addedEdgeIds,
        },
      });
    },
    purgeMany: async ({ ids = [], staleDocuments = false }) => {
      await request("/api/objects/purge-many", { method: "POST", body: { ids, staleDocuments } });
    },
    createEdge: (input) => request("/api/edges", { method: "POST", body: input }),
    deleteEdge: (id) => request(`/api/edges/${encodeURIComponent(id)}`, { method: "DELETE" }),
    uploadFile: async (file) => {
      if (file.size > MAX_FILE_BYTES)
        throw new DataSourceError(413, "too_large", "This file is larger than 25 MB.");
      const body = new FormData();
      body.append("file", file, file.name);
      let res: Response;
      try {
        res = await fetch("/api/files", { method: "POST", body, credentials: "same-origin" });
      } catch {
        throw new DataSourceError(0, "network", "Could not reach the server.");
      }
      if (res.ok) return (await res.json()) as StoredFile;
      let message = `The server answered ${res.status}.`;
      let code = "error";
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        code = err.error?.code ?? code;
        message = err.error?.message ?? message;
      } catch {
        /* keep the generic message */
      }
      throw new DataSourceError(res.status, code, message);
    },
    fileUrl: (storagePath) => `/api/files/${encodeURIComponent(storagePath)}`,
    deleteFile: (storagePath) =>
      request(`/api/files/${encodeURIComponent(storagePath)}`, { method: "DELETE" }),
  };
}
