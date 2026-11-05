import type { ApiEdge, ApiObject } from "@/domain/api-types";
import type { LocationLevel, ObjectType } from "@/domain/enums";

/**
 * The Map's model, derived from the shared graph. Nothing here is a second data model: places
 * are `location` objects, the hierarchy is their `contains` edges, and "what is here" is the
 * `located_at` edges. Anything without coordinates is listed, never plotted at a guess.
 */
export interface Place {
  id: string;
  title: string;
  level: LocationLevel;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  parentId: string | null;
  childIds: string[];
  /** Objects located here, most important first. */
  objectIds: string[];
}

export interface MapObject {
  id: string;
  type: ObjectType;
  title: string;
  status: ApiObject["status"];
  placeId: string;
}

/** Two places worth drawing a line between, because something at one relates to something at the other. */
export interface Connection {
  a: string;
  b: string;
}

export interface MapModel {
  places: Map<string, Place>;
  /** Places with no parent: the first rung down from Earth. */
  roots: string[];
  objects: Map<string, MapObject>;
  /** Places that cannot be plotted yet. */
  unplaced: string[];
  /** Deduplicated, unordered pairs of distinct placed locations. */
  connections: Connection[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const LEVELS: readonly LocationLevel[] = [
  "planet",
  "country",
  "region",
  "city",
  "district",
  "neighbourhood",
  "address",
  "site",
];
const isLevel = (v: unknown): v is LocationLevel => LEVELS.includes(v as LocationLevel);

export function buildMapModel(nodes: readonly ApiObject[], edges: readonly ApiEdge[]): MapModel {
  const places = new Map<string, Place>();
  for (const n of nodes) {
    if (n.type !== "location") continue;
    const lat = num(n.details?.lat);
    const lng = num(n.details?.lng);
    const cc = n.details?.countryCode;
    places.set(n.id, {
      id: n.id,
      title: n.title,
      level: isLevel(n.details?.level) ? n.details.level : "site",
      countryCode: typeof cc === "string" ? cc : null,
      // Half a coordinate is no coordinate.
      lat: lat !== null && lng !== null ? lat : null,
      lng: lat !== null && lng !== null ? lng : null,
      parentId: null,
      childIds: [],
      objectIds: [],
    });
  }

  for (const e of edges) {
    if (e.kind !== "contains") continue;
    const parent = places.get(e.from);
    const child = places.get(e.to);
    if (!parent || !child) continue;
    child.parentId = parent.id;
    parent.childIds.push(child.id);
  }
  for (const p of places.values())
    p.childIds.sort((a, b) =>
      (places.get(a)?.title ?? "").localeCompare(places.get(b)?.title ?? ""),
    );

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const objects = new Map<string, MapObject>();
  for (const e of edges) {
    if (e.kind !== "located_at") continue;
    const subject = byId.get(e.from);
    const place = places.get(e.to);
    if (!subject || !place || subject.type === "location" || subject.status === "dropped") continue;
    objects.set(subject.id, {
      id: subject.id,
      type: subject.type,
      title: subject.title,
      status: subject.status,
      placeId: place.id,
    });
    place.objectIds.push(subject.id);
  }
  // Projects first, then by title: what a place is *for* leads.
  const rank = (t: ObjectType): number =>
    t === "project" || t === "sub_project" ? 0 : t === "property" ? 1 : t === "event" ? 2 : 3;
  for (const p of places.values())
    p.objectIds.sort((a, b) => {
      const x = objects.get(a) as MapObject;
      const y = objects.get(b) as MapObject;
      return rank(x.type) - rank(y.type) || x.title.localeCompare(y.title);
    });

  const roots = [...places.values()]
    .filter((p) => p.parentId === null)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => p.id);
  const unplaced = [...places.values()]
    .filter((p) => p.lat === null)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => p.id);

  // The nearest place an object can claim: itself if it is directly located, otherwise its
  // nearest container (walking up `contains`) that is. A task has no coordinates of its own,
  // but the project that contains it usually does.
  const containerOf = new Map<string, string>();
  for (const e of edges) if (e.kind === "contains") containerOf.set(e.to, e.from);
  const placeCache = new Map<string, string | null>();
  const nearestPlace = (objectId: string): string | null => {
    if (placeCache.has(objectId)) return placeCache.get(objectId) as string | null;
    placeCache.set(objectId, null); // guards against a cycle while resolving
    const direct = objects.get(objectId)?.placeId ?? (places.has(objectId) ? objectId : null);
    const resolved =
      direct ??
      (containerOf.has(objectId) ? nearestPlace(containerOf.get(objectId) as string) : null);
    placeCache.set(objectId, resolved);
    return resolved;
  };

  // Connections: any non-structural relation between two objects that resolve to different
  // places. `contains` and `located_at` are structure, not a relationship worth drawing a line
  // for on the globe.
  const seenPairs = new Set<string>();
  const connections: Connection[] = [];
  for (const e of edges) {
    if (e.kind === "contains" || e.kind === "located_at") continue;
    const a = nearestPlace(e.from);
    const b = nearestPlace(e.to);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    connections.push({ a, b });
  }

  return { places, roots, objects, unplaced, connections };
}

/** The chain from the top of the hierarchy down to a place, e.g. Borland › Bremont › Ironfield. */
export function ancestry(model: MapModel, id: string): Place[] {
  const chain: Place[] = [];
  const seen = new Set<string>();
  let cur = model.places.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? model.places.get(cur.parentId) : undefined;
  }
  return chain;
}

/** A place and everything inside it. */
export function withDescendants(model: MapModel, id: string): Place[] {
  const out: Place[] = [];
  const stack = [id];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = model.places.get(stack.pop() as string);
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    out.push(cur);
    stack.push(...cur.childIds);
  }
  return out;
}

/** How close to look at a place of each kind. The camera comes to a country, then a city, then a door. */
export const LEVEL_ZOOM: Record<LocationLevel, number> = {
  planet: 1.1,
  country: 4.4,
  region: 6.2,
  city: 9.6,
  district: 11.8,
  neighbourhood: 13.2,
  address: 15.2,
  site: 14.6,
};

export interface GeoBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** The smallest box around the placed members of a set of places. */
export function geoBox(list: readonly Pick<Place, "lat" | "lng">[]): GeoBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of list) {
    if (p.lat === null || p.lng === null) continue;
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

export type CameraTarget =
  | { kind: "center"; lng: number; lat: number; zoom: number }
  | { kind: "box"; box: GeoBox; maxZoom: number };

/**
 * Where the camera goes to show a place: to the place itself at the zoom of its level, or, if
 * it has placed places inside it that would not all fit at that zoom, to a box around them.
 */
export function targetForPlace(model: MapModel, id: string): CameraTarget | null {
  const place = model.places.get(id);
  if (!place) return null;
  const inside = withDescendants(model, id);
  const box = geoBox(inside);
  if (!box) return null;
  const single = place.lat !== null && inside.filter((p) => p.lat !== null).length === 1;
  if (single || box.west === box.east) {
    return {
      kind: "center",
      lng: place.lng as number,
      lat: place.lat as number,
      zoom: LEVEL_ZOOM[place.level],
    };
  }
  return { kind: "box", box, maxZoom: LEVEL_ZOOM[place.level] };
}

/** The place an object is at (for moving the camera when an object is selected elsewhere). */
export function placeOf(model: MapModel, objectId: string): Place | null {
  const o = model.objects.get(objectId);
  return o ? (model.places.get(o.placeId) ?? null) : null;
}

/** Which object type dominates a place, so its marker can carry that colour. */
export function dominantType(model: MapModel, place: Place): ObjectType {
  const first = place.objectIds[0];
  return first ? (model.objects.get(first) as MapObject).type : "location";
}

export interface MarkerGroup {
  key: string;
  lng: number;
  lat: number;
  placeIds: string[];
}

/**
 * Groups places whose screen positions are closer than `minDistance` px, so a crowd shows one
 * marker with a count instead of a smear. `project` maps a place to pixels (or `null` if it is
 * hidden, e.g. on the far side of the globe).
 */
export function groupMarkers(
  placed: readonly Place[],
  project: (p: Place) => { x: number; y: number } | null,
  minDistance: number,
): MarkerGroup[] {
  const groups: { x: number; y: number; members: Place[] }[] = [];
  for (const p of placed) {
    const pt = project(p);
    if (!pt) continue;
    const home = groups.find((g) => Math.hypot(g.x - pt.x, g.y - pt.y) < minDistance);
    if (home) home.members.push(p);
    else groups.push({ x: pt.x, y: pt.y, members: [p] });
  }
  return groups.map((g) => {
    const lat = g.members.reduce((s, m) => s + (m.lat as number), 0) / g.members.length;
    const lng = g.members.reduce((s, m) => s + (m.lng as number), 0) / g.members.length;
    const ids = g.members.map((m) => m.id).sort();
    return {
      key: ids.length === 1 ? `place:${ids[0]}` : `group:${ids.join(",")}`,
      lng,
      lat,
      placeIds: ids,
    };
  });
}
