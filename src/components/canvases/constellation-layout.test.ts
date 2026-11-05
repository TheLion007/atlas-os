import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { buildConstellation } from "@/domain/memory-constellation";
import { buildMemoryRows } from "@/domain/memory-model";
import { layoutConstellation } from "./constellation-layout";

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

describe("layoutConstellation", () => {
  it("lays out thousands of memories", () => {
    const objects: ApiObject[] = [];
    const edges: ApiEdge[] = [];
    for (let p = 0; p < 12; p++)
      objects.push(obj({ id: `p${p}`, type: "project", title: `P${p}` }));
    for (let i = 0; i < 3000; i++) {
      objects.push(mem(`m${i}`, [`t${i % 40}`, `u${i % 7}`]));
      edges.push(edge("about", `m${i}`, `p${i % 12}`));
    }
    // Scale, not speed: a wall-clock budget is flaky on a loaded test runner.
    const rows = buildMemoryRows(objects, edges);
    const c = buildConstellation(rows, objects, edges);
    const positions = layoutConstellation(c);
    expect(c.nodes.length).toBe(3012);
    expect(positions.size).toBe(3012);
    for (const p of positions.values()) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  }, 120_000);

  it("is deterministic and keeps placed points where they are when memories are added", () => {
    const { objects, edges, rows } = scene();
    const c = buildConstellation(rows, objects, edges);
    const first = layoutConstellation(c);
    expect(layoutConstellation(c)).toEqual(first);

    const extra = mem("m_new", ["tax"]);
    const objects2 = [...objects, extra];
    const edges2 = [...edges, edge("about", "m_new", "p_fin")];
    const c2 = buildConstellation(buildMemoryRows(objects2, edges2), objects2, edges2);
    const second = layoutConstellation(c2, first);
    for (const [id, p] of first) expect(second.get(id)).toEqual(p);
    expect(second.get("m_new")).toBeDefined();
  });

  it("gives clusters depth, and keeps a cluster's members nearer its own centre", () => {
    const { objects, edges, rows } = scene();
    const c = buildConstellation(rows, objects, edges);
    const pos = layoutConstellation(c);
    const zs = new Set([...pos.values()].map((p) => Math.round(p.z)));
    expect(zs.size).toBeGreaterThan(1);
    const hub = pos.get("p_fin")!;
    const d = (id: string) => Math.hypot(pos.get(id)!.x - hub.x, pos.get(id)!.y - hub.y);
    expect(d("m_tax")).toBeLessThan(d("m_design"));
  });
});
