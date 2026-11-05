import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { GlobeCameraController, type OrbitLike } from "./camera-controller";
import { vector3ToLatLng } from "./geo3d";

function rig() {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  const controls: OrbitLike & { updates: number } = {
    enabled: true,
    updates: 0,
    update() {
      this.updates++;
    },
  };
  const c = new GlobeCameraController();
  return { camera, controls, c };
}

describe("GlobeCameraController", () => {
  it("places the camera immediately, at the requested distance", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 25, lng: 55, distance: 30 });
    expect(camera.position.length()).toBeCloseTo(30, 6);
    const { lat, lng } = vector3ToLatLng(camera.position, 30);
    expect(lat).toBeCloseTo(25, 4);
    expect(lng).toBeCloseTo(55, 4);
  });

  it("hands the camera to a fly, and back to the controls when it lands", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 0, lng: 0, distance: 30 });
    c.flyTo({ lat: 50, lng: 4, distance: 12 }, 1000);
    expect(controls.enabled).toBe(false);
    expect(c.isFlying()).toBe(true);

    expect(c.update(0)).toBe(true); // the tween's clock starts on its first update
    expect(c.update(500)).toBe(true);
    const mid = vector3ToLatLng(camera.position, camera.position.length());
    // Roughly between the two: not still at the start, not yet at the end.
    expect(mid.lat).toBeGreaterThan(0);
    expect(mid.lat).toBeLessThan(50);

    expect(c.update(1000)).toBe(false);
    expect(c.isFlying()).toBe(false);
    expect(controls.enabled).toBe(true);
    const end = vector3ToLatLng(camera.position, camera.position.length());
    expect(end.lat).toBeCloseTo(50, 3);
    expect(end.lng).toBeCloseTo(4, 3);
    expect(camera.position.length()).toBeCloseTo(12, 3);
  });

  it("keeps updating past the duration idempotently (never overshoots)", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 0, lng: 0, distance: 30 });
    c.flyTo({ lat: 10, lng: 10, distance: 20 }, 200);
    c.update(0);
    c.update(9999); // way past the end
    const end = vector3ToLatLng(camera.position, camera.position.length());
    expect(end.lat).toBeCloseTo(10, 3);
    expect(camera.position.length()).toBeCloseTo(20, 3);
  });

  it("does nothing when there is no fly in progress", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 1, lng: 2, distance: 30 });
    const before = controls.updates;
    expect(c.update(100)).toBe(false);
    expect(controls.updates).toBe(before);
  });

  it("cancel() hands control back without finishing the move", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 0, lng: 0, distance: 30 });
    c.flyTo({ lat: 80, lng: 0, distance: 15 }, 1000);
    c.update(0);
    c.update(200);
    c.cancel();
    expect(c.isFlying()).toBe(false);
    expect(controls.enabled).toBe(true);
    const partway = vector3ToLatLng(camera.position, camera.position.length());
    expect(partway.lat).toBeLessThan(80); // stayed wherever the tween had gotten to
  });

  it("reports its own position for the next fly to start from, mid-flight", () => {
    const { camera, controls, c } = rig();
    c.attach(camera, controls);
    c.applyImmediate({ lat: 0, lng: 0, distance: 30 });
    c.flyTo({ lat: 60, lng: 0, distance: 15 }, 1000);
    c.update(0);
    c.update(500);
    const now = c.current();
    c.flyTo({ lat: -20, lng: 90, distance: 25 }, 1000);
    const restarted = c.current();
    expect(restarted.lat).toBeCloseTo(now.lat, 6);
  });
});
