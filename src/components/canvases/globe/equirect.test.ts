import type { FeatureCollection, MultiLineString, Polygon } from "geojson";
import { describe, expect, it } from "vitest";
import { borderPaths, landPaths, project, projectPath } from "./equirect";

const W = 360;
const H = 180;

describe("project", () => {
  it("puts the four corners of the world at the four corners of the canvas", () => {
    expect(project(-180, 90, W, H)).toEqual({ x: 0, y: 0 });
    expect(project(180, 90, W, H)).toEqual({ x: W, y: 0 });
    expect(project(-180, -90, W, H)).toEqual({ x: 0, y: H });
    expect(project(0, 0, W, H)).toEqual({ x: W / 2, y: H / 2 });
  });
});

describe("projectPath", () => {
  it("keeps an ordinary ring as one path", () => {
    const paths = projectPath(
      [
        [4, 50],
        [5, 51],
        [4, 51],
        [4, 50],
      ],
      W,
      H,
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(4);
  });

  it("splits a ring that crosses the antimeridian instead of drawing a seam across the map", () => {
    const paths = projectPath(
      [
        [178, 10],
        [179.5, 10],
        [-179.5, 10], // crosses from +180 to -180
        [-178, 10],
      ],
      W,
      H,
    );
    expect(paths).toHaveLength(2);
    expect(paths[0]!.every((p) => p.x > W / 2)).toBe(true); // the +178..+179.5 half
    expect(paths[1]!.every((p) => p.x < W / 2)).toBe(true); // the -179.5..-178 half
  });

  it("drops a path with fewer than two points", () => {
    expect(projectPath([[4, 50]], W, H)).toEqual([]);
    expect(projectPath([], W, H)).toEqual([]);
  });
});

describe("landPaths", () => {
  const square: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  };
  const land: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: square },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [square.coordinates, square.coordinates] },
      },
    ],
  };

  it("flattens Polygon and MultiPolygon features into projected rings", () => {
    const paths = landPaths(land as FeatureCollection, W, H);
    // 1 ring from the Polygon + 2 rings from the MultiPolygon.
    expect(paths).toHaveLength(3);
    for (const ring of paths) expect(ring.length).toBe(5);
  });
});

describe("borderPaths", () => {
  it("projects every line of the mesh", () => {
    const mls: MultiLineString = {
      type: "MultiLineString",
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
        [
          [2, 2],
          [3, 3],
          [4, 4],
        ],
      ],
    };
    const paths = borderPaths(mls, W, H);
    expect(paths.map((p) => p.length)).toEqual([2, 3]);
  });
});
