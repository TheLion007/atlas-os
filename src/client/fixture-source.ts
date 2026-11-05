import type {
  ActivityAction,
  ActivityEntry,
  ProgressEntry,
  ApiEdge,
  ApiObject,
  ApiObjectWithRelations,
} from "@/domain/api-types";
import { isConvertible } from "@/domain/creation";
import { isEdgeAllowed } from "@/domain/edge-rules";
import { validateNewEdge } from "@/domain/graph-validation";
import { withRelations } from "@/domain/relations";
import { createEdgeSchema, createObjectSchema } from "@/domain/schemas";
import type { FixtureData } from "@/seed/fixtures";
import {
  DataSourceError,
  MAX_FILE_BYTES,
  storagePathFor,
  sha256Hex,
  type AtlasDataSource,
} from "./data-source";

export interface FixtureOptions {
  /** Called after every write so a browser session can keep the user's changes. */
  onChange?: (data: FixtureData) => void;
  newId?: () => string;
}

const invalid = (message: string) => new DataSourceError(400, "validation", message);
const conflict = (message: string) => new DataSourceError(409, "conflict", message);
const missing = () => new DataSourceError(404, "not_found", "Object not found");

/**
 * In-memory source over the fixture data. Development and tests only. It enforces the
 * same rules as the API on every write (the shared Zod schemas, the edge matrix, cycles and
 * single parents), so a flow that works here works against the database, and one the database
 * would reject is rejected here too.
 */
export function createFixtureSource(
  initial: FixtureData,
  options: FixtureOptions = {},
): AtlasDataSource {
  const newId = options.newId ?? (() => crypto.randomUUID());
  // Own copies: writes never mutate the caller's data.
  const data: FixtureData = {
    ...initial,
    nodes: [...initial.nodes],
    edges: [...initial.edges],
    activity: [...initial.activity],
    progress: [...(initial.progress ?? [])],
  };
  const now = () => new Date(`${data.today}T09:00:00Z`);

  const log = (action: ActivityAction, entry: Partial<ActivityEntry> = {}) => {
    const id = data.activity.reduce((m, a) => Math.max(m, a.id), 0) + 1;
    data.activity = [
      {
        id,
        action,
        at: now().toISOString(),
        objectId: null,
        edgeId: null,
        object: null,
        diff: {},
        ...entry,
      },
      ...data.activity,
    ];
  };
  /** The project an object counts for: the first project above it, or one it references. */
  const projectAbove = (start: string): string | null => {
    if (data.nodes.find((n) => n.id === start)?.type === "project") return start;
    let cur = start;
    for (let depth = 0; depth < 8; depth++) {
      const up = data.edges.find((e) => e.kind === "contains" && e.to === cur);
      if (!up) return null;
      if (data.nodes.find((n) => n.id === up.from)?.type === "project") return up.from;
      cur = up.from;
    }
    return null;
  };
  const projectFor = (id: string): string | null => {
    const own = projectAbove(id);
    if (own) return own;
    for (const e of data.edges) {
      if (e.kind !== "references" || (e.from !== id && e.to !== id)) continue;
      const found = projectAbove(e.from === id ? e.to : e.from);
      if (found) return found;
    }
    return null;
  };
  const logProgress = (kind: ProgressEntry["kind"], objectId: string) => {
    const id = data.progress.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    const at = now().toISOString();
    data.progress = [
      { id, at, day: at.slice(0, 10), projectId: projectFor(objectId), objectId, kind },
      ...data.progress,
    ];
  };
  const commit = () => options.onChange?.({ ...data });
  // The fixture file store: bytes kept in memory for the session (development only, like the
  // rest of this source). A seeded document has no bytes here, and says so.
  const files = new Map<string, { blob: Blob; url: string | null }>();
  for (const f of initial.files ?? [])
    files.set(f.path, { blob: new Blob([f.text], { type: f.mime }), url: null });
  const find = (id: string): ApiObject => {
    const node = data.nodes.find((n) => n.id === id);
    if (!node) throw missing();
    return node;
  };

  const addEdge = (raw: unknown): ApiEdge => {
    const parsed = createEdgeSchema.safeParse(raw);
    if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid relation.");
    const e = parsed.data;
    const from = find(e.from);
    const to = find(e.to);
    const violations = validateNewEdge(
      { kind: e.kind, from: e.from, to: e.to, fromType: from.type, toType: to.type },
      data.edges,
    );
    if (violations[0]) throw conflict(violations[0].message);
    const edge: ApiEdge = {
      id: newId(),
      kind: e.kind,
      from: e.from,
      to: e.to,
      label: e.label,
      dependencyType: e.dependencyType,
      lagDays: e.lagDays,
      createdAt: now().toISOString(),
    };
    data.edges = [...data.edges, edge];
    log("related", { edgeId: edge.id, objectId: e.from, diff: { kind: e.kind } });
    return edge;
  };

  return {
    mode: "fixtures",
    today: () => data.today,
    now,
    graph: async () => ({ nodes: data.nodes, edges: data.edges }),
    object: async (id) => withRelations(find(id), data.nodes, data.edges),
    activity: async (limit = 30) => {
      const byId = new Map(data.nodes.map((n) => [n.id, n]));
      return data.activity.slice(0, limit).map((a) => {
        const node = a.objectId ? byId.get(a.objectId) : undefined;
        return { ...a, object: node ? { type: node.type, title: node.title } : null };
      });
    },
    progress: async (days = 120) => {
      const since = new Date(now().getTime() - days * 86_400_000).toISOString().slice(0, 10);
      const alive = new Set(data.nodes.map((n) => n.id));
      return data.progress.filter(
        (p) => p.day >= since && (p.objectId === null || alive.has(p.objectId)),
      );
    },
    settings: async () => data.settings,

    createObject: async (input, relations = []): Promise<ApiObjectWithRelations> => {
      const parsed = createObjectSchema.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid object.");
      const o = parsed.data;
      const at = now().toISOString();
      const node: ApiObject = {
        id: newId(),
        type: o.type,
        title: o.title,
        status: o.status,
        tags: o.tags,
        confidence: o.confidence,
        color: o.color,
        createdAt: at,
        updatedAt: at,
        details: o.details as Record<string, unknown>,
      };

      // All-or-nothing, like the API's transaction: validate against a scratch copy first.
      const before = {
        nodes: data.nodes,
        edges: data.edges,
        activity: data.activity,
        progress: data.progress,
      };
      try {
        data.nodes = [...data.nodes, node];
        log("created", { objectId: node.id });
        for (const r of relations) {
          addEdge({
            kind: r.kind,
            from: r.direction === "out" ? node.id : r.other,
            to: r.direction === "out" ? r.other : node.id,
            label: r.label ?? null,
          });
        }
        if (node.type === "note") logProgress("note_created", node.id);
        else if (node.type === "document") logProgress("file_added", node.id);
      } catch (e) {
        Object.assign(data, before);
        throw e;
      }
      commit();
      return withRelations(node, data.nodes, data.edges);
    },

    updateObject: async (id, patch) => {
      const current = find(id);
      const next = {
        type: current.type,
        title: patch.title ?? current.title,
        status: patch.status ?? current.status,
        tags: patch.tags ?? current.tags,
        confidence: patch.confidence === undefined ? current.confidence : patch.confidence,
        color: patch.color === undefined ? current.color : patch.color,
        details: { ...(current.details ?? {}), ...(patch.details ?? {}) },
      };
      const parsed = createObjectSchema.safeParse(next);
      if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid update.");
      const o = parsed.data;
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (o.title !== current.title) diff.title = { from: current.title, to: o.title };
      if (o.status !== current.status) diff.status = { from: current.status, to: o.status };
      for (const [k, v] of Object.entries(o.details as Record<string, unknown>)) {
        const was = (current.details ?? {})[k];
        if (JSON.stringify(was) !== JSON.stringify(v)) diff[k] = { from: was ?? null, to: v };
      }
      const updated: ApiObject = {
        ...current,
        title: o.title,
        status: o.status,
        tags: o.tags,
        confidence: o.confidence,
        color: o.color,
        updatedAt: now().toISOString(),
        details: o.details as Record<string, unknown>,
      };
      data.nodes = data.nodes.map((n) => (n.id === id ? updated : n));
      if (Object.keys(diff).length > 0) log("updated", { objectId: id, diff });
      if (updated.type === "task" && updated.status === "done" && current.status !== "done")
        logProgress("task_done", id);
      commit();
      return updated;
    },

    convertObjectType: async (id, type) => {
      const current = find(id);
      if (!isConvertible(current.type)) throw invalid("This type cannot change category.");
      if (current.type === type) throw invalid("Already that category.");
      const d = current.details ?? {};
      const droppedFields: string[] = [];
      let newDetails: Record<string, unknown>;
      const projectish = (t: string) => t === "project" || t === "sub_project";
      if (projectish(current.type) && projectish(type)) {
        newDetails = { ...d };
        if (type === "sub_project" && d.budgetAmount !== null && d.budgetAmount !== undefined) {
          droppedFields.push("budgetAmount", "budgetCurrency");
          newDetails.budgetAmount = null;
          newDetails.budgetCurrency = null;
        }
      } else {
        for (const key of Object.keys(d)) if (key !== "description") droppedFields.push(key);
        newDetails = { description: (d.description as string | undefined) ?? "" };
      }

      const candidate = {
        type,
        title: current.title,
        status: current.status,
        tags: current.tags,
        confidence: current.confidence,
        color: current.color,
        details: newDetails,
      };
      const parsed = createObjectSchema.safeParse(candidate);
      if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? "Invalid conversion.");

      const byIdMap = new Map(data.nodes.map((n) => [n.id, n]));
      const touching = data.edges.filter((e) => e.from === id || e.to === id);
      const kept = touching.filter((e) => {
        const fromType = e.from === id ? type : byIdMap.get(e.from)?.type;
        const toType = e.to === id ? type : byIdMap.get(e.to)?.type;
        return !!fromType && !!toType && isEdgeAllowed(e.kind, fromType, toType);
      });

      const at = now().toISOString();
      const newNode: ApiObject = {
        id: newId(),
        type: parsed.data.type,
        title: parsed.data.title,
        status: parsed.data.status,
        tags: parsed.data.tags,
        confidence: parsed.data.confidence,
        color: parsed.data.color,
        createdAt: at,
        updatedAt: at,
        details: parsed.data.details as Record<string, unknown>,
      };

      const before = {
        nodes: data.nodes,
        edges: data.edges,
        activity: data.activity,
        progress: data.progress,
      };
      try {
        data.nodes = [...data.nodes, newNode];
        log("created", { objectId: newNode.id });
        for (const e of kept) {
          addEdge({
            kind: e.kind,
            from: e.from === id ? newNode.id : e.from,
            to: e.to === id ? newNode.id : e.to,
            label: e.label,
            dependencyType: e.dependencyType,
            lagDays: e.lagDays,
          });
        }
        data.nodes = data.nodes.filter((n) => n.id !== id);
        data.edges = data.edges.filter((e) => e.from !== id && e.to !== id);
        log("deleted", { objectId: null, diff: { type: current.type, title: current.title } });
      } catch (e) {
        Object.assign(data, before);
        throw e;
      }
      commit();
      return {
        object: withRelations(newNode, data.nodes, data.edges),
        droppedRelations: touching.length - kept.length,
        droppedFields: [...new Set(droppedFields)],
      };
    },

    deleteObject: async (id) => {
      const node = find(id);
      data.nodes = data.nodes.filter((n) => n.id !== id);
      data.edges = data.edges.filter((e) => e.from !== id && e.to !== id);
      log("deleted", { objectId: null, diff: { type: node.type, title: node.title } });
      commit();
    },

    deleteMany: async ({ ids, reattach = [] }) => {
      const set = new Set(ids);
      const nodes = data.nodes.filter((n) => set.has(n.id));
      if (nodes.length !== set.size) throw missing();
      const edges = data.edges.filter((e) => set.has(e.from) || set.has(e.to));
      const progress = data.progress.filter((p) => p.objectId !== null && set.has(p.objectId));
      const documents = nodes
        .filter((n) => n.type === "document")
        .map((n) => ({
          id: n.id,
          storagePath:
            typeof n.details?.storagePath === "string" ? (n.details.storagePath as string) : null,
        }));
      data.nodes = data.nodes.filter((n) => !set.has(n.id));
      data.edges = data.edges.filter((e) => !set.has(e.from) && !set.has(e.to));
      data.progress = data.progress.filter((p) => p.objectId === null || !set.has(p.objectId));
      for (const n of nodes)
        log("deleted", { objectId: null, diff: { type: n.type, title: n.title } });
      const added: string[] = [];
      try {
        for (const r of reattach)
          added.push(addEdge({ ...r, label: null, dependencyType: null, lagDays: null }).id);
      } catch (e) {
        // all or nothing, like the database transaction
        data.nodes = [...data.nodes, ...nodes];
        data.edges = [...data.edges.filter((x) => !added.includes(x.id)), ...edges];
        data.progress = [...progress, ...data.progress];
        throw e;
      }
      commit();
      return {
        objectIds: [...set],
        edgeIds: edges.map((e) => e.id),
        addedEdgeIds: added,
        documents,
        snapshot: { nodes, edges, progress },
      };
    },

    restoreMany: async (receipt) => {
      const snap = receipt.snapshot;
      if (!snap) throw new DataSourceError(409, "not_restorable", "Nothing to restore.");
      const back = new Set(snap.nodes.map((n) => n.id));
      if (data.nodes.some((n) => back.has(n.id))) throw conflict("These items are already back.");
      data.edges = data.edges.filter((e) => !receipt.addedEdgeIds.includes(e.id));
      data.nodes = [...data.nodes, ...snap.nodes];
      const alive = new Set(data.nodes.map((n) => n.id));
      const revived: ApiEdge[] = [];
      for (const e of snap.edges) {
        if (!alive.has(e.from) || !alive.has(e.to)) continue;
        if (data.edges.some((x) => x.id === e.id)) continue;
        if (
          e.kind === "contains" &&
          [...data.edges, ...revived].some((x) => x.kind === "contains" && x.to === e.to)
        )
          continue;
        revived.push(e);
      }
      data.edges = [...data.edges, ...revived];
      data.progress = [...snap.progress, ...data.progress];
      for (const n of snap.nodes) log("restored", { objectId: n.id, diff: {} });
      commit();
    },

    // The demo keeps nothing aside once a deletion is final: there is nothing more to free here
    // (the bytes of a document go through `deleteFile`, which the caller calls).
    purgeMany: async () => {},

    createEdge: async (input) => {
      const edge = addEdge(input);
      commit();
      return edge;
    },

    deleteEdge: async (id) => {
      const edge = data.edges.find((e) => e.id === id);
      if (!edge) throw new DataSourceError(404, "not_found", "Relation not found");
      data.edges = data.edges.filter((e) => e.id !== id);
      log("unrelated", { edgeId: id, objectId: edge.from, diff: { kind: edge.kind } });
      commit();
    },
    uploadFile: async (file) => {
      if (file.size > MAX_FILE_BYTES)
        throw new DataSourceError(413, "too_large", "This file is larger than 25 MB.");
      const bytes = await file.arrayBuffer();
      const storagePath = storagePathFor(newId(), file.name);
      files.set(storagePath, { blob: new Blob([bytes], { type: file.type }), url: null });
      return {
        storagePath,
        sizeBytes: bytes.byteLength,
        mime: file.type || "application/octet-stream",
        checksum: await sha256Hex(bytes),
      };
    },

    fileUrl: (storagePath) => {
      const f = files.get(storagePath);
      if (!f) return null;
      if (!f.url && typeof URL.createObjectURL === "function") {
        try {
          f.url = URL.createObjectURL(f.blob);
        } catch {
          return null; // an environment that cannot make object URLs: the preview says so
        }
      }
      return f.url;
    },

    deleteFile: async (storagePath) => {
      const f = files.get(storagePath);
      if (f?.url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(f.url);
      files.delete(storagePath);
    },
  };
}
