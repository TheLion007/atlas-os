import type { MascotMood } from "@/lib/feedback/celebrate";

/** What the 3D mascot can express. The same words Atlas uses for its own moments. */
export type PipExpression =
  | "idle"
  | "thinking"
  | "working"
  | "greeting"
  | "happy"
  | "error"
  | "dizzy"
  | "sleeping"
  | "dancing";

export const PIP_EXPRESSIONS: readonly PipExpression[] = [
  "idle",
  "thinking",
  "working",
  "greeting",
  "happy",
  "error",
  "dizzy",
  "sleeping",
  "dancing",
];

/** Pip's palette (the same colours as the flat Pip, so the two stay recognisably one creature). */
export const PIP = {
  body: "#E8AC3E",
  belly: "#F4CC7E",
  crest: "#DD5530",
  ink: "#1D221F",
  white: "#FFFFFF",
  cheek: "#F07A5A",
  mouthInside: "#7A2E1A",
  think: "#B9A4F2",
  work: "#6FB4F0",
  alert: "#E5484D",
  sweat: "#8FD0F5",
  sleep: "#8A8277",
} as const;

export type EyeStyle = "open" | "happy" | "sleep" | "flat" | "dizzy";
export type MouthStyle = "smile" | "grin" | "flat" | "small" | "wavy";
export type ArmStyle = "rest" | "wave" | "swing" | "type";

export interface ExpressionSpec {
  eyes: EyeStyle;
  mouth: MouthStyle;
  arms: ArmStyle;
  /** Where the pupils look instead of following the pointer, in -1…1. */
  look?: { x: number; y: number };
  cheeks: number;
  bobSpeed: number;
  bobAmp: number;
  swaySpeed: number;
  sway: number;
  /** A single hop each time the expression is entered. */
  hop: boolean;
  /** Keeps bouncing for as long as the expression lasts. */
  bounce: boolean;
  tilt: number;
}

export const EXPRESSIONS: Record<PipExpression, ExpressionSpec> = {
  idle: {
    eyes: "open",
    mouth: "smile",
    arms: "rest",
    cheeks: 0.5,
    bobSpeed: 1.8,
    bobAmp: 0.02,
    swaySpeed: 1.1,
    sway: 0.015,
    hop: false,
    bounce: false,
    tilt: 0,
  },
  thinking: {
    eyes: "open",
    mouth: "small",
    arms: "rest",
    look: { x: 0.7, y: 0.75 },
    cheeks: 0.4,
    bobSpeed: 1.4,
    bobAmp: 0.015,
    swaySpeed: 0.8,
    sway: 0.05,
    hop: false,
    bounce: false,
    tilt: 0.08,
  },
  working: {
    eyes: "open",
    mouth: "flat",
    arms: "type",
    look: { x: 0, y: -0.7 },
    cheeks: 0.3,
    bobSpeed: 3.2,
    bobAmp: 0.02,
    swaySpeed: 2.2,
    sway: 0.02,
    hop: false,
    bounce: false,
    tilt: 0,
  },
  greeting: {
    eyes: "happy",
    mouth: "grin",
    arms: "wave",
    cheeks: 0.8,
    bobSpeed: 2.4,
    bobAmp: 0.03,
    swaySpeed: 2.4,
    sway: 0.05,
    hop: true,
    bounce: false,
    tilt: -0.05,
  },
  happy: {
    eyes: "happy",
    mouth: "grin",
    arms: "rest",
    cheeks: 0.9,
    bobSpeed: 2.2,
    bobAmp: 0.025,
    swaySpeed: 1.6,
    sway: 0.03,
    hop: true,
    bounce: false,
    tilt: 0,
  },
  error: {
    eyes: "flat",
    mouth: "wavy",
    arms: "rest",
    cheeks: 0.2,
    bobSpeed: 1.2,
    bobAmp: 0.01,
    swaySpeed: 18,
    sway: 0.03,
    hop: false,
    bounce: false,
    tilt: 0,
  },
  dizzy: {
    eyes: "dizzy",
    mouth: "wavy",
    arms: "swing",
    cheeks: 0.6,
    bobSpeed: 2.6,
    bobAmp: 0.03,
    swaySpeed: 3.2,
    sway: 0.14,
    hop: false,
    bounce: false,
    tilt: 0,
  },
  sleeping: {
    eyes: "sleep",
    mouth: "small",
    arms: "rest",
    cheeks: 0.4,
    bobSpeed: 0.9,
    bobAmp: 0.025,
    swaySpeed: 0.7,
    sway: 0.02,
    hop: false,
    bounce: false,
    tilt: 0.12,
  },
  dancing: {
    eyes: "happy",
    mouth: "grin",
    arms: "swing",
    cheeks: 0.9,
    bobSpeed: 7,
    bobAmp: 0.1,
    swaySpeed: 3.5,
    sway: 0.16,
    hop: false,
    bounce: true,
    tilt: 0,
  },
};

/** Atlas's own mood words, translated to what Pip shows. */
export function expressionForMood(mood: MascotMood): PipExpression {
  switch (mood) {
    case "sleep":
      return "sleeping";
    case "cheer":
      return "dancing";
    case "happy":
      return "happy";
    default:
      return "idle";
  }
}
