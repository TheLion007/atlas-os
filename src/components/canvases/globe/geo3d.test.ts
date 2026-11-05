import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  boxCenter,
  distanceToFitBox,
  easeInOutCubic,
  greatCircleArc,
  latLngToUv,
  latLngToVector3,
  slerp,
  vector3ToLatLng,
  zoomToDistance,
} from "./geo3d";

describe("latLngToVector3 / vector3ToLatLng", () => {
  it("puts a point exactly `radius` from the centre", () => {
    const p = latLngToVector3(25.2, 55.27, 10);
    expect(p.length()).toBeCloseTo(10, 6);
  });

  it("sends the poles to +Y and -Y regardless of longitude", () => {
    expect(latLngToVector3(90, 0, 1)).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(1) });
    expect(latLngToVector3(90, 137, 1)).toMatchObject({
      x: expect.closeTo(0),
      y: expect.closeTo(1),
    });
    expect(latLngToVector3(-90, -40, 1).y).toBeCloseTo(-1, 6);
  });

  it("round-trips for a spread of real places", () => {
    const places: [number, number][] = [
      [25.2048, 55.2708], // Dorsel
      [50.8503, 4.3517], // Bremont
      [-33.8688, 151.2093], // Sydney
      [0, 0],
      [0, 179.9],
      [0, -179.9],
      [51.5074, -0.1278], // London
    ];
    for (const [lat, lng] of places) {
      const back = vector3ToLatLng(latLngToVector3(lat, lng, 5), 5);
      expect(back.lat, `lat of ${lat},${lng}`).toBeCloseTo(lat, 4);
      expect(((back.lng - lng + 540) % 360) - 180, `lng of ${lat},${lng}`).toBeCloseTo(0, 4);
    }
  });

  it("agrees with the texture UV for the same point", () => {
    // The prime meridian at the equator sits at the seam between the texture's two halves.
    const uv = latLngToUv(0, 0);
    expect(uv).toEqual({ u: 0.5, v: 0.5 });
    expect(latLngToUv(90, -180)).toEqual({ u: 0, v: 0 });
    expect(latLngToUv(-90, 180)).toEqual({ u: 1, v: 1 });
  });
});

describe("slerp", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 1, 0);
    expect(slerp(a, b, 0).toArray()).toEqual([1, 0, 0]);
    const end = slerp(a, b, 1);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(1, 6);
  });

  it("stays unit length along the way, unlike a straight lerp", () => {
    const a = new Vector3(1, 0, 0);
    const b = new Vector3(0, 0, 1);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(slerp(a, b, t).length()).toBeCloseTo(1, 6);
  });

  it("handles two (nearly) identical directions without NaN", () => {
    const a = new Vector3(1, 0, 0);
    const p = slerp(a, a.clone(), 0.5);
    expect(Number.isNaN(p.x)).toBe(false);
    expect(p.toArray()).toEqual([1, 0, 0]);
  });
});

describe("greatCircleArc", () => {
  it("starts and ends exactly at the two places, on the sphere", () => {
    const pts = greatCircleArc(50.85, 4.35, 25.2, 55.27, 10, 20);
    expect(pts[0]!.length()).toBeCloseTo(10, 5);
    expect(pts.at(-1)!.length()).toBeCloseTo(10, 5);
    const start = vector3ToLatLng(pts[0]!, 10);
    expect(start.lat).toBeCloseTo(50.85, 3);
    expect(start.lng).toBeCloseTo(4.35, 3);
  });

  it("bulges outward, peaking near the midpoint, and never dips below the surface", () => {
    const pts = greatCircleArc(50.85, 4.35, 25.2, 55.27, 10, 40);
    const radii = pts.map((p) => p.length());
    for (const r of radii) expect(r).toBeGreaterThanOrEqual(10 - 1e-6);
    const mid = radii[Math.floor(radii.length / 2)]!;
    expect(mid).toBeGreaterThan(radii[0]!);
    expect(mid).toBeGreaterThan(radii.at(-1)!);
  });

  it("lifts a hemisphere-spanning arc more than a short hop, proportionately", () => {
    const short = greatCircleArc(50.8, 4.3, 50.9, 4.4, 10, 20);
    const long = greatCircleArc(50.85, 4.35, -33.87, 151.21, 10, 20);
    const peak = (pts: ReturnType<typeof greatCircleArc>) =>
      Math.max(...pts.map((p) => p.length()));
    expect(peak(long) - 10).toBeGreaterThan(peak(short) - 10);
  });
});

describe("distanceToFitBox", () => {
  it("asks for more distance to fit a wider box at the same fov", () => {
    const near = distanceToFitBox({ west: 4, east: 5, south: 50, north: 51 }, 10, 45);
    const far = distanceToFitBox({ west: -20, east: 60, south: 10, north: 55 }, 10, 45);
    expect(far).toBeGreaterThan(near);
  });

  it("never puts the camera inside the sphere", () => {
    const d = distanceToFitBox({ west: 0, east: 0.01, south: 0, north: 0.01 }, 10, 60);
    expect(d).toBeGreaterThan(10);
  });

  it("needs less distance for a wider field of view", () => {
    const narrowFov = distanceToFitBox({ west: 0, east: 10, south: 0, north: 10 }, 10, 20);
    const wideFov = distanceToFitBox({ west: 0, east: 10, south: 0, north: 10 }, 10, 80);
    expect(wideFov).toBeLessThan(narrowFov);
  });
});

describe("boxCenter / easing", () => {
  it("centres a box", () => {
    expect(boxCenter({ west: 0, east: 10, south: 0, north: 20 })).toEqual({ lat: 10, lng: 5 });
  });

  it("eases from 0 to 1, symmetric about the midpoint", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 6);
  });
});

describe("zoomToDistance", () => {
  it("puts the extremes of the old zoom scale at the extremes of the distance range", () => {
    expect(zoomToDistance(1.1, 12.5, 80)).toBeCloseTo(80, 6);
    expect(zoomToDistance(15.2, 12.5, 80)).toBeCloseTo(12.5, 6);
  });

  it("is monotonically decreasing: a higher zoom is always closer", () => {
    const zooms = [1.1, 4.4, 6.2, 9.6, 11.8, 15.2];
    const distances = zooms.map((z) => zoomToDistance(z, 12.5, 80));
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeLessThan(distances[i - 1]!);
  });

  it("never leaves the [min, max] range even outside the tuned zoom bounds", () => {
    expect(zoomToDistance(0, 12.5, 80)).toBeLessThanOrEqual(80);
    expect(zoomToDistance(30, 12.5, 80)).toBeGreaterThanOrEqual(12.5);
  });
});
