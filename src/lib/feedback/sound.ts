import { usePrefs, type SoundKind, type SoundProfile } from "./prefs";

/**
 * The small satisfying sounds, synthesised with Web Audio (no audio files to ship). They are
 * built to be easy on the ears: soft waves only (sine or triangle, never square or saw), low
 * notes, a gentle 8 ms attack, a short rounded decay, a low-pass filter that takes the edge off,
 * and a limiter over everything so nothing ever spikes. Three profiles trade softness for clarity.
 */
export interface SoundPlan {
  notes: readonly { freq: number; len: number }[];
  wave: "sine" | "triangle";
  /** Low-pass cut-off, in Hz. */
  cutoff: number;
  /** Fraction of the master volume this sound plays at. */
  gain: number;
}

/** The base notes, in Hz and seconds, at the "soft" profile. */
const NOTES: Record<SoundKind, readonly (readonly [number, number])[]> = {
  click: [[330, 0.035]],
  check: [
    [392, 0.05],
    [523, 0.07],
  ],
  done: [
    [523, 0.08],
    [659, 0.08],
    [784, 0.16],
  ],
  create: [
    [392, 0.07],
    [494, 0.07],
    [587, 0.07],
    [784, 0.18],
  ],
  drop: [
    [294, 0.05],
    [392, 0.08],
  ],
  error: [
    [196, 0.12],
    [165, 0.2],
  ],
};

const PROFILE: Record<SoundProfile, { pitch: number; cutoff: number; wave: SoundPlan["wave"] }> = {
  soft: { pitch: 1, cutoff: 2000, wave: "sine" },
  normal: { pitch: 1.25, cutoff: 3000, wave: "triangle" },
  crystal: { pitch: 1.6, cutoff: 4500, wave: "triangle" },
};

/** What a sound is made of, as plain data (so it can be tested without an audio device). */
export function soundPlan(kind: SoundKind, profile: SoundProfile = "soft"): SoundPlan {
  const p = PROFILE[profile];
  return {
    notes: NOTES[kind].map(([freq, len]) => ({ freq: Math.round(freq * p.pitch), len })),
    wave: kind === "error" ? "sine" : p.wave,
    cutoff: p.cutoff,
    gain: kind === "error" ? 0.7 : 1,
  };
}

const ATTACK = 0.008;
let audio: AudioContext | null = null;
let bus: AudioNode | null = null;

/** One shared chain: low-pass → compressor/limiter → master. Built on first use. */
function chain(ctx: AudioContext, cutoff: number): AudioNode {
  if (!bus) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -20;
    limiter.knee.value = 8;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    limiter.connect(ctx.destination);
    bus = limiter;
  }
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  filter.Q.value = 0.5;
  filter.connect(bus);
  return filter;
}

/** `force` plays even when this kind is switched off (the Settings preview buttons). */
export function playSound(kind: SoundKind, force = false): void {
  const prefs = usePrefs.getState();
  if (typeof window === "undefined" || !prefs.soundOn || (!force && !prefs.sounds[kind])) return;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
    const plan = soundPlan(kind, prefs.soundProfile);
    const out = chain(audio, plan.cutoff);
    const peak = (prefs.volume / 100) * 0.3 * plan.gain;
    let at = audio.currentTime + 0.005;
    for (const { freq, len } of plan.notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = plan.wave;
      osc.frequency.setValueAtTime(freq, at);
      // Soft attack, then a rounded, exponential decay that is gone a moment after the note.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(Math.max(peak, 0.0002), at + ATTACK);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.14);
      osc.connect(gain);
      gain.connect(out);
      osc.start(at);
      osc.stop(at + len + 0.16);
      at += len * 0.85;
    }
  } catch {
    // No audio device or blocked: silence is fine.
  }
}
