import type { Camera } from "three";
import { easeInOutCubic, latLngToVector3, slerp, vector3ToLatLng } from "./geo3d";

/** Where the camera looks from: a point on the ray from the globe's centre through (lat, lng). */
export interface CameraTarget {
  lat: number;
  lng: number;
  distance: number;
}

/** The little the controller needs from `OrbitControls`, so it is testable without one. */
export interface OrbitLike {
  enabled: boolean;
  update: () => void;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Cinematic camera moves for the globe: flying from wherever the camera currently is to a
 * (lat, lng, distance) target along the great circle between them, eased in and out, while
 * `OrbitControls` is briefly handed off so the user's last drag never fights the tween. Pure
 * with respect to time — `update(now)` is given the clock, so it is exercised in a test with a
 * fake clock exactly as it runs in the browser.
 */
export class GlobeCameraController {
  camera: Camera | null = null;
  controls: OrbitLike | null = null;
  private tween: { from: CameraTarget; to: CameraTarget; start: number | null; ms: number } | null =
    null;

  /** Wires the camera and controls this drives. Does not move anything — see `applyImmediate`. */
  attach(camera: Camera, controls: OrbitLike | null): void {
    this.camera = camera;
    this.controls = controls;
  }

  /** The camera's current position, expressed the same way a target is. */
  current(): CameraTarget {
    if (!this.camera) return { lat: 0, lng: 0, distance: 0 };
    const distance = this.camera.position.length();
    const { lat, lng } = vector3ToLatLng(this.camera.position, distance || 1);
    return { lat, lng, distance };
  }

  /** Jump straight there: no tween, for the very first frame. */
  applyImmediate(target: CameraTarget): void {
    if (!this.camera) return;
    const p = latLngToVector3(target.lat, target.lng, target.distance);
    this.camera.position.copy(p);
    this.camera.lookAt(0, 0, 0);
    this.controls?.update();
  }

  /** True while a fly is in progress (the caller can use this to keep its render loop alive). */
  isFlying(): boolean {
    return this.tween !== null;
  }

  flyTo(target: CameraTarget, ms = 1800): void {
    if (!this.camera) return;
    this.tween = { from: this.current(), to: target, start: null, ms };
    if (this.controls) this.controls.enabled = false;
  }

  /** Cancels any fly in progress, e.g. because the user grabbed the camera. */
  cancel(): void {
    this.tween = null;
    if (this.controls) this.controls.enabled = true;
  }

  /** Advances the tween to `now` (ms). Returns whether it is still going. */
  update(now: number): boolean {
    if (!this.tween || !this.camera) return false;
    const tw = this.tween;
    tw.start ??= now;
    const p = clamp01((now - tw.start) / tw.ms);
    const e = easeInOutCubic(p);
    const a = latLngToVector3(tw.from.lat, tw.from.lng, 1);
    const b = latLngToVector3(tw.to.lat, tw.to.lng, 1);
    const dir = slerp(a, b, e);
    const distance = tw.from.distance + (tw.to.distance - tw.from.distance) * e;
    this.camera.position.set(dir.x * distance, dir.y * distance, dir.z * distance);
    this.camera.lookAt(0, 0, 0);
    this.controls?.update();
    if (p >= 1) {
      this.tween = null;
      if (this.controls) this.controls.enabled = true;
      return false;
    }
    return true;
  }
}
