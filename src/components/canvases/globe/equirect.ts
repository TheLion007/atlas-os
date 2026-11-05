import type { Feature, FeatureCollection, Geometry, MultiLineString, Position } from "geojson";

/**
 * Projects real GeoJSON geometry (Natural Earth land polygons and country-border lines, in
 * [lng, lat] degrees) onto pixel coordinates of an equirectangular canvas of `width` × `height`.
 * Pure and framework-free, so the projection itself — including the one real wrinkle, a ring
 * that crosses the antimeridian — is unit-tested without a canvas.
 *
 * A ring or line is split into more than one pixel path wherever two consecutive points would
 * otherwise cross from one edge of the canvas to the other (e.g. Russia or Fiji, which span
 * ±180°): drawn as one path, that crossing would appear as a spurious line all the way across
 * the map. Splitting is a standard, honest simplification for this projection; it never moves a
 * real coordinate.
 */
export interface Point {
  x: number;
  y: number;
}

export function project(lng: number, lat: number, width: number, height: number): Point {
  return { x: ((lng + 180) / 360) * width, y: ((90 - lat) / 180) * height };
}

/** One ring/line projected to pixels, split into continuous pieces at the antimeridian. */
export function projectPath(coords: readonly Position[], width: number, height: number): Point[][] {
  const paths: Point[][] = [];
  let current: Point[] = [];
  let prev: Point | null = null;
  for (const c of coords) {
    const p = project(c[0] as number, c[1] as number, width, height);
    if (prev && Math.abs(p.x - prev.x) > width / 2) {
      if (current.length > 1) paths.push(current);
      current = [];
    }
    current.push(p);
    prev = p;
  }
  if (current.length > 1) paths.push(current);
  return paths;
}

function polygonPaths(rings: readonly Position[][], width: number, height: number): Point[][] {
  return rings.flatMap((ring) => projectPath(ring, width, height));
}

/** Every ring of every polygon in a land FeatureCollection, projected and antimeridian-split. */
export function landPaths(
  land: FeatureCollection<Geometry>,
  width: number,
  height: number,
): Point[][] {
  const out: Point[][] = [];
  for (const f of land.features as Feature<Geometry>[]) {
    const g = f.geometry;
    if (g.type === "Polygon") out.push(...polygonPaths(g.coordinates, width, height));
    else if (g.type === "MultiPolygon")
      for (const poly of g.coordinates) out.push(...polygonPaths(poly, width, height));
  }
  return out;
}

/** Every line of a country-border mesh, projected and antimeridian-split. */
export function borderPaths(borders: MultiLineString, width: number, height: number): Point[][] {
  return borders.coordinates.flatMap((line) => projectPath(line, width, height));
}
