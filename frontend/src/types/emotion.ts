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
  confidence?: number; // [0, 1]
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

// One row of the timeline — the unit the backend will eventually stream.
export interface TimelineFrame {
  t: number; // seconds from start
  duration: number; // seconds this frame holds
  text: string; // subtitle text
  emotion: Emotion;
}
