// Shared types for SoundShape's emotion → visual pipeline.
// This is the contract between the (eventually-real) backend timeline
// JSON and the frontend renderer. Keeping the types co-located so the
// frontend can be built today against hardcoded data and switched to
// real data in Phase 4 without changing any consumer code.

export type EmotionCategory =
  | "joy"
  | "sadness"
  | "anger"
  | "fear"
  | "surprise"
  | "neutral"
  | "sincerity"
  | "resignation"
  | "sarcasm";

export interface Emotion {
  category: EmotionCategory;
  valence: number; // [-1, +1]  negative ↔ positive
  arousal: number; // [-1, +1]  calm ↔ excited
  confidence?: number; // [0, 1] — category confidence
  dominance?: number; // [-1, +1] — from audeering dimensional model
  category_short?: string; // "ang"|"hap"|"neu"|"sad" — backend code
}

export type ShapeKind =
  | "flowing_wave"
  | "soft_circle"
  | "drooping_ellipse"
  | "jagged_star"
  | "trembling_spikes"
  | "expanding_burst"
  | "simple_circle";

export interface HSLColor {
  h: number; // 0–360
  s: number; // 0–100
  l: number; // 0–100
}

export type MotionType =
  | "still"
  | "slow_drift"
  | "pulse"
  | "shake"
  | "tremor"
  | "sink";

export interface MotionSpec {
  type: MotionType;
  amplitude: number; // 0–1
  speed: number; // 0–1
}

export interface VisualSpec {
  shape: ShapeKind;
  color: HSLColor;
  size: number; // 0–1, relative size of the rendered shape
  motion: MotionSpec;
}

// One word + its tight Whisper timestamp, used for fine-grained caption sync.
export interface Word {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

// Prosodic feature snapshot for a segment (Phase 5+ will use these for
// per-feature motion modulation; Phase 4 just exposes them in the debug panel).
export interface Prosody {
  duration: number;
  f0_mean: number;
  f0_std: number;
  f0_min: number;
  f0_max: number;
  f0_range: number;
  intensity_mean: number;
  intensity_std: number;
  intensity_min: number;
  intensity_max: number;
  jitter_local: number;
  shimmer_local: number;
  hnr_mean: number;
  voiced_ratio: number;
  speech_rate_approx: number;
}

// One row of the timeline — what the backend emits + what the renderer consumes.
// `words` and `prosody` are optional so hardcoded demo data still satisfies the type.
export interface TimelineFrame {
  t: number; // seconds from start
  duration: number; // seconds this frame holds
  text: string; // subtitle text
  emotion: Emotion;
  words?: Word[];
  prosody?: Prosody;
  visual?: VisualSpec; // backend pre-computes this; frontend also recomputes locally
}

// Full backend response: metadata + segments.
export interface Timeline {
  metadata: {
    duration: number;
    sample_rate: number;
    language: string;
  };
  segments: TimelineFrame[];
}
