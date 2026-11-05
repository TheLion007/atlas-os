import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  buildConstellation,
  constellationNeighbours,
  UNFILED_CLUSTER,
} from "./memory-constellation";
import { buildMemoryRows } from "./memory-model";

const obj = (over: Partial<ApiObject> & Pick<ApiObject, "id" | "type" | "title">): ApiObject => ({
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const edge = (kind: ApiEdge["kind"], from: string, to: string): ApiEdge => ({
  id: `${from}-${kind}-${to}`,
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const mem = (id: string, tags: string[] = [], memoryType = "fact") =>
  obj({ id, type: "memory", title: `Memory ${id}`, tags, details: { memoryType } });

function scene() {
  const finance = obj({ id: "p_fin", type: "project", title: "Finance", color: "teal" });
  const nirys = obj({ id: "p_nir", type: "project", title: "Nirys", color: "rose" });
  const doc = obj({ id: "doc", type: "document", title: "Tax return.pdf" });
  const objects = [
    finance,
    nirys,
    doc,
    mem("m_tax", ["tax", "borland"]),
    mem("m_etf", ["etf"]),
    mem("m_dorsel", ["tax", "dorsel"]),
    mem("m_design", ["design"]),
    mem("m_brand", ["design", "brand"]),
    mem("m_loose1", ["ideas"]),
    mem("m_loose2", ["ideas"]),
    mem("m_alone"),
  ];
  const edges = [
    edge("about", "m_tax", "p_fin"),
    edge("about", "m_etf", "p_fin"),
    edge("about", "m_dorsel", "p_fin"),
    edge("about", "m_design", "p_nir"),
    edge("about", "m_brand", "p_nir"),
    edge("supported_by", "m_tax", "doc"),
    edge("references", "m_brand", "m_dorsel"),
  ];
  const rows = buildMemoryRows(objects, edges);
  return { objects, edges, rows };
}

describe("buildConstellation", () => {
  it("clusters memories by project, then by a shared tag, then as unfiled", () => {
    const { objects, edges, rows } = scene();
    const c = buildConstellation(rows, objects, edges);
    const clusterOf = (id: string) => c.nodes.find((n) => n.id === id)!.clusterId;
    expect(clusterOf("m_tax")).toBe("p_fin");
    expect(clusterOf("m_etf")).toBe("p_fin");
    expect(clusterOf("m_design")).toBe("p_nir");
    expect(clusterOf("m_loose1")).toBe(clusterOf("m_loose2"));
    expect(c.clusters.find((cl) => cl.id === clusterOf("m_loose1"))).toMatchObject({
      source: "tag",
      title: "ideas",
      size: 2,
    });
    expect(clusterOf("m_alone")).toBe(UNFILED_CLUSTER);
    const fin = c.clusters.find((cl) => cl.id === "p_fin")!;
    expect(fin).toMatchObject({ title: "Finance", color: "teal", size: 3 });
    expect(c.nodes[fin.hub!]!.id).toBe("p_fin");
  });

  it("draws only real relations: stored edges plus affinities above the threshold", () => {
    const { objects, edges, rows } = scene();
    const c = buildConstellation(rows, objects, edges);
    const has = (a: string, b: string) =>
      c.links.find((l) => {
        const x = c.nodes[l.a]!.id;
        const y = c.nodes[l.b]!.id;
        return (x === a && y === b) || (x === b && y === a);
      });
    // Stored relations.
    expect(has("m_tax", "p_fin")?.reason).toBe("about");
    expect(has("m_tax", "doc")?.reason).toBe("source");
    expect(has("m_brand", "m_dorsel")?.reason).toBe("explicit");
    // Same project + a shared tag is a strong affinity; tags alone can connect across projects.
    expect(has("m_tax", "m_dorsel")).toBeTruthy();
    expect(has("m_design", "m_brand")).toBeTruthy();
    // Nothing links memories that share nothing.
    expect(has("m_alone", "m_tax")).toBeUndefined();
    expect(has("m_etf", "m_design")).toBeUndefined();
    for (const l of c.links) {
      expect(l.strength).toBeGreaterThan(0);
      expect(l.strength).toBeLessThanOrEqual(1);
    }
    const tax = c.nodes.findIndex((n) => n.id === "m_tax");
    expect(constellationNeighbours(c, tax)).toContain(c.nodes.findIndex((n) => n.id === "doc"));
  });

  it("stays sparse: each memory keeps only its strongest inferred links", () => {
    const objects: ApiObject[] = [obj({ id: "p", type: "project", title: "Big" })];
    const edges: ApiEdge[] = [];
    for (let i = 0; i < 60; i++) {
      objects.push(mem(`m${String(i).padStart(2, "0")}`, ["shared"]));
      edges.push(edge("about", `m${String(i).padStart(2, "0")}`, "p"));
    }
    const c = buildConstellation(buildMemoryRows(objects, edges), objects, edges, {
      maxInferredPerNode: 4,
    });
    const inferred = c.links.filter((l) => l.kind === null);
    // Far below the 1 770 pairs "everything to everything" would draw.
    expect(inferred.length).toBeLessThanOrEqual(60 * 4);
    expect(inferred.length).toBeGreaterThan(0);
  });

  it("respects the lens filters: a memory not shown is not drawn, nor its relations", () => {
    const { objects, edges, rows } = scene();
    const c = buildConstellation(
      rows.filter((r) => r.id !== "m_dorsel"),
      objects,
      edges,
    );
    expect(c.nodes.some((n) => n.id === "m_dorsel")).toBe(false);
  });

  it("brings a memory's documents and financial objects in as satellites, and can narrow them", () => {
    const { objects, edges, rows } = scene();
    const all = buildConstellation(rows, objects, edges);
    expect(all.nodes.find((n) => n.id === "doc")).toMatchObject({
      kind: "satellite",
      type: "document",
    });
    const narrowed = buildConstellation(rows, objects, edges, { satelliteTypes: ["estimate"] });
    expect(narrowed.nodes.some((n) => n.id === "doc")).toBe(false);
    // Project hubs are never filtered out: they are what clusters are made of.
    expect(narrowed.nodes.some((n) => n.id === "p_fin")).toBe(true);
  });

  it("is deterministic", () => {
    const { objects, edges, rows } = scene();
    expect(buildConstellation(rows, objects, edges)).toEqual(
      buildConstellation([...rows].reverse(), objects, [...edges].reverse()),
    );
  });

  it("clusters memories by plan too, exactly like a project", () => {
    const plan = obj({ id: "pl1", type: "plan", title: "Dorsel plan", color: "sand" });
    const objects = [plan, mem("m1")];
    const edges = [edge("about", "m1", "pl1")];
    const c = buildConstellation(buildMemoryRows(objects, edges), objects, edges);
    const clusterOf = (id: string) => c.nodes.find((n) => n.id === id)!.clusterId;
    expect(clusterOf("m1")).toBe("pl1");
    const cl = c.clusters.find((x) => x.id === "pl1")!;
    expect(cl).toMatchObject({ title: "Dorsel plan", color: "sand", size: 1 });
    expect(c.nodes[cl.hub!]).toMatchObject({ id: "pl1", kind: "hub", type: "plan" });
  });

  it("shows every project/sub-project/plan as its own empty hub, even with no memories yet", () => {
    const plan = obj({ id: "pl1", type: "plan", title: "Empty plan" });
    const project = obj({ id: "p1", type: "project", title: "Empty project" });
    const sub = obj({ id: "sp1", type: "sub_project", title: "Empty sub-project" });
    const dropped = obj({ id: "pl2", type: "plan", title: "Archived plan", status: "dropped" });
    const objects = [plan, project, sub, dropped];
    const c = buildConstellation(buildMemoryRows(objects, []), objects, []);
    for (const id of ["pl1", "p1", "sp1"]) {
      const cl = c.clusters.find((x) => x.id === id);
      expect(cl, id).toMatchObject({ size: 0 });
      expect(c.nodes[cl!.hub!], id).toMatchObject({ id, kind: "hub" });
    }
    // A dropped (archived) object does not clutter the map.
    expect(c.clusters.some((x) => x.id === "pl2")).toBe(false);
  });
});
