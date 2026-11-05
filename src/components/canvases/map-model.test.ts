import { describe, expect, it } from "vitest";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import {
  LEVEL_ZOOM,
  ancestry,
  buildMapModel,
  dominantType,
  geoBox,
  groupMarkers,
  placeOf,
  targetForPlace,
  withDescendants,
} from "./map-model";
import { exampleSeed } from "@tests/fixtures/example-seed";

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

const data = buildFixtureData(exampleSeed());
const model = buildMapModel(data.nodes, data.edges);
const id = seedId;

describe("the map model comes from the shared graph", () => {
  it("makes a place of every location, with its hierarchy from contains edges", () => {
    expect(model.places.size).toBe(8);
    expect(model.roots.map((r) => model.places.get(r)?.title)).toEqual(["Borland", "Uplands"]);
    expect(model.places.get(id("dorsel"))?.childIds.map((c) => model.places.get(c)?.title)).toEqual(
      ["Birch Bay", "Dorsel Marina", "Juniper Lake Towers"],
    );
    expect(model.places.get(id("marina"))?.parentId).toBe(id("dorsel"));
  });

  it("names the chain from the top down, so the map can show a breadcrumb", () => {
    expect(ancestry(model, id("marina")).map((p) => p.title)).toEqual([
      "Uplands",
      "Dorsel",
      "Dorsel Marina",
    ]);
    expect(ancestry(model, id("borland")).map((p) => p.title)).toEqual(["Borland"]);
    expect(ancestry(model, "nope")).toEqual([]);
  });

  it("finds a place and everything inside it", () => {
    expect(
      withDescendants(model, id("uplands"))
        .map((p) => p.title)
        .sort(),
    ).toEqual(["Birch Bay", "Dorsel", "Dorsel Marina", "Juniper Lake Towers", "Uplands"]);
  });

  it("puts objects at their place: projects first, dropped ones never", () => {
    const dorsel = model.places.get(id("dorsel"))!;
    const titles = dorsel.objectIds.map((o) => model.objects.get(o)?.title);
    expect(titles).toContain("Dorsel relocation");
    expect(titles.indexOf("Dorsel relocation")).toBeLessThan(
      titles.indexOf("Scout Dorsel neighbourhoods") === -1
        ? 99
        : titles.indexOf("Scout Dorsel neighbourhoods"),
    );
    expect(placeOf(model, id("p_marina"))?.title).toBe("Dorsel Marina");
    expect(placeOf(model, id("p_reloc"))?.title).toBe("Dorsel");
    expect(placeOf(model, id("t_visa"))).toBeNull(); // not located anywhere
  });

  it("never plots a place without coordinates", () => {
    const nodes = [
      ...data.nodes,
      {
        ...data.nodes.find((n) => n.id === id("dorsel"))!,
        id: "no-coords",
        title: "Somewhere",
        details: { level: "city", countryCode: null, lat: 10, lng: null },
      },
    ];
    const m = buildMapModel(nodes, data.edges);
    expect(m.places.get("no-coords")).toMatchObject({ lat: null, lng: null });
    expect(m.unplaced).toEqual(["no-coords"]);
  });

  it("colours a place by what is there, and falls back to the place itself", () => {
    expect(dominantType(model, model.places.get(id("marina"))!)).toBe("project");
    expect(dominantType(model, model.places.get(id("borland"))!)).toBe("location");
  });

  it("works for any place on Earth: nothing is specific to one city", () => {
    const empty = buildMapModel([], []);
    expect(empty.places.size).toBe(0);
    expect(empty.roots).toEqual([]);
    expect(targetForPlace(empty, "x")).toBeNull();
  });
});

describe("where the camera goes", () => {
  it("comes to a single place at the zoom of its level", () => {
    const t = targetForPlace(model, id("marina"));
    expect(t).toEqual({ kind: "center", lng: 55.14, lat: 25.08, zoom: LEVEL_ZOOM.district });
    expect(LEVEL_ZOOM.country).toBeLessThan(LEVEL_ZOOM.city);
    expect(LEVEL_ZOOM.city).toBeLessThan(LEVEL_ZOOM.district);
    expect(LEVEL_ZOOM.district).toBeLessThan(LEVEL_ZOOM.address);
  });

  it("frames the places inside a country or city instead of a single point", () => {
    const t = targetForPlace(model, id("dorsel"));
    expect(t?.kind).toBe("box");
    if (t?.kind === "box") {
      expect(t.box.west).toBeCloseTo(55.14);
      expect(t.box.east).toBeCloseTo(55.27);
      expect(t.maxZoom).toBe(LEVEL_ZOOM.city);
    }
  });

  it("bounds only what can be plotted", () => {
    expect(geoBox([{ lat: null, lng: null }])).toBeNull();
    expect(
      geoBox([
        { lat: 1, lng: 2 },
        { lat: 3, lng: -4 },
      ]),
    ).toEqual({ west: -4, south: 1, east: 2, north: 3 });
  });
});

describe("connections between locations", () => {
  it("finds a real one from the fixtures: a dependency that crosses from Dorsel back to Borland", () => {
    // Savings (a Dorsel relocation milestone) depends on the Ironfield flat actually selling — a
    // relation between two objects, neither of which is itself a location, that nonetheless
    // crosses from one country to another once each is resolved up to its nearest placed
    // container.
    const keys = model.connections.map((c) => pairKey(c.a, c.b));
    expect(keys).toContain(pairKey(id("dorsel"), id("ironfield")));
  });

  it("never connects a place to itself, and never duplicates a pair", () => {
    for (const c of model.connections) expect(c.a).not.toBe(c.b);
    const keys = model.connections.map((c) => pairKey(c.a, c.b));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores structure (contains, located_at): those are hierarchy, not a relationship", () => {
    // Every contains/located_at edge in the fixtures resolves within a single place or a
    // place-to-itself; none of them should surface as a cross-location connection on their own.
    const onlyStructural = buildMapModel(
      data.nodes,
      data.edges.filter((e) => e.kind === "contains" || e.kind === "located_at"),
    );
    expect(onlyStructural.connections).toEqual([]);
  });

  it("is empty when nothing relates across places", () => {
    expect(buildMapModel([], []).connections).toEqual([]);
  });
});

describe("crowded markers", () => {
  const placed = [...model.places.values()].filter((p) => p.lat !== null);
  // A fake projection: 1° = 4 px, so Dorsel's districts fall within a few pixels of each other.
  const project = (p: { lat: number | null; lng: number | null }) => ({
    x: (p.lng as number) * 4,
    y: (p.lat as number) * 4,
  });

  it("groups places that would overlap and keeps far ones apart", () => {
    const groups = groupMarkers(placed, project, 30);
    const dorselGroup = groups.find((g) => g.placeIds.includes(id("marina")))!;
    expect(dorselGroup.placeIds).toEqual(
      expect.arrayContaining([id("marina"), id("jlt"), id("birchbay"), id("dorsel")]),
    );
    expect(dorselGroup.key.startsWith("group:")).toBe(true);
    const borland = groups.find((g) => g.placeIds.includes(id("borland")))!;
    expect(borland.placeIds).not.toContain(id("dorsel"));
  });

  it("separates them again when zoomed in", () => {
    const zoomed = (p: { lat: number | null; lng: number | null }) => ({
      x: (p.lng as number) * 4000,
      y: (p.lat as number) * 4000,
    });
    const groups = groupMarkers(placed, zoomed, 30);
    expect(groups.find((g) => g.placeIds.includes(id("marina")))?.placeIds).toEqual([id("marina")]);
    expect(groups.every((g) => g.placeIds.length === 1)).toBe(true);
  });

  it("skips places that are hidden, such as the far side of the globe", () => {
    const groups = groupMarkers(placed, (p) => (p.countryCode === "BE" ? null : project(p)), 30);
    expect(groups.flatMap((g) => g.placeIds)).not.toContain(id("borland"));
  });
});
