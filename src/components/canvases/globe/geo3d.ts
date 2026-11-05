import { Vector3 } from "three";

/**
 * Pure spherical geometry for the globe: latitude/longitude in and out of the sphere Three.js
 * actually draws, great-circle interpolation for the connection arcs, and the camera framing
 * maths. Nothing here touches React or a renderer, so it is tested the same way as the rest of
 * the domain layer.
 *
 * The convention (radius, latitude, longitude) → position matches `THREE.SphereGeometry`'s own
 * UV layout exactly, so a marker computed here and the equirectangular texture drawn in
 * `earth-texture.ts` always agree on where a place is.
 */
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function latLngToVector3(lat: number, lng: number, radius: number, out = new Vector3()) {
  const phi = (90 - lat) * DEG;
  const theta = (lng + 180) * DEG;
  const sinPhi = Math.sin(phi);
  return out.set(
    -radius * Math.cos(theta) * sinPhi,
    radius * Math.cos(phi),
    radius * Math.sin(theta) * sinPhi,
  );
}

/** The inverse of {@link latLngToVector3}: a point on (or near) the sphere back to lat/lng. */
export function vector3ToLatLng(p: Vector3, radius = p.length()): { lat: number; lng: number } {
  const y = Math.min(1, Math.max(-1, p.y / radius));
  const phi = Math.acos(y);
  const theta = Math.atan2(p.z, -p.x);
  const lng = (theta < 0 ? theta + 2 * Math.PI : theta) * RAD - 180;
  return { lat: 90 - phi * RAD, lng };
}

/** Where an equirectangular texture (as drawn in earth-texture.ts) shows a given lat/lng. */
export function latLngToUv(lat: number, lng: number): { u: number; v: number } {
  return { u: (lng + 180) / 360, v: (90 - lat) / 180 };
}

/** Spherical linear interpolation between two unit-length directions. */
export function slerp(a: Vector3, b: Vector3, t: number, out = new Vector3()): Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const angle = Math.acos(dot);
  if (angle < 1e-6) return out.copy(a);
  const sinAngle = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sinAngle;
  const wb = Math.sin(t * angle) / sinAngle;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

/**
 * Points along the great-circle arc from one place to another, lifted off the surface so it
 * reads as a connection and not a tunnel through the planet. The bulge peaks at the midpoint and
 * scales with how far apart the two places are, so a short hop and a hemisphere-spanning one
 * both look proportionate.
 */
export function greatCircleArc(
  latA: number,
  lngA: number,
  latB: number,
  lngB: number,
  radius: number,
  segments = 48,
): Vector3[] {
  const a = latLngToVector3(latA, lngA, 1);
  const b = latLngToVector3(latB, lngB, 1);
  const angleBetween = Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
  const maxLift = radius * (0.08 + 0.22 * (angleBetween / Math.PI));
  const points: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const dir = slerp(a, b, t);
    const lift = radius + maxLift * Math.sin(Math.PI * t);
    points.push(new Vector3(dir.x * lift, dir.y * lift, dir.z * lift));
  }
  return points;
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface GeoBoxLike {
  west: number;
  east: number;
  south: number;
  north: number;
}

/**
 * The camera distance (sphere radii from the centre) at which a lat/lng box fills a comfortable
 * fraction of the view, for a perspective camera with the given vertical field of view. `margin`
 * (>1) leaves room around the box; a tighter box or a wider fov needs less distance.
 */
export function distanceToFitBox(
  box: GeoBoxLike,
  radius: number,
  verticalFovDeg: number,
  margin = 1.6,
): number {
  const latSpan = Math.max(1, box.north - box.south);
  const lngSpan = Math.max(1, box.east - box.west);
  // The angular span of the box as seen from the centre of the sphere, in radians.
  const angularSpan =
    Math.max(latSpan, lngSpan * Math.cos(((box.north + box.south) / 2) * DEG)) * DEG;
  const halfFov = (verticalFovDeg * DEG) / 2;
  // Distance from the sphere's surface such that the chord subtending `angularSpan` fills the
  // frame at `halfFov`, then converted to distance from the centre.
  const chord = 2 * radius * Math.sin(angularSpan / 2);
  const distanceFromSurface = (chord / 2 / Math.tan(halfFov)) * margin;
  return radius + Math.max(radius * 0.15, distanceFromSurface);
}

/** The midpoint of a lat/lng box (its own centre, not a great-circle centroid — boxes are small). */
export function boxCenter(box: GeoBoxLike): { lat: number; lng: number } {
  return { lat: (box.north + box.south) / 2, lng: (box.east + box.west) / 2 };
}

/**
 * Converts the old flat-map "zoom" scale (`LEVEL_ZOOM` in map-model.ts: 1.1 for a planet, 15.2
 * for a single address) into an orbit distance in sphere radii, so the same per-level tuning
 * drives both a projected map and a real camera. One more unit of zoom halves the apparent
 * ground distance, exactly like the web-Mercator convention it was tuned against.
 */
export function zoomToDistance(
  zoom: number,
  minDistance: number,
  maxDistance: number,
  zoomAtMax = 1.1,
  zoomAtMin = 15.2,
): number {
  const doublings = Math.log2(maxDistance / minDistance);
  const perZoomUnit = doublings / (zoomAtMin - zoomAtMax);
  const distance = maxDistance / Math.pow(2, (zoom - zoomAtMax) * perZoomUnit);
  return Math.min(maxDistance, Math.max(minDistance, distance));
}
