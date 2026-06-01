import rawConfig from "@/config/mapping_config.json";
import type {
  Emotion,
  HSLColor,
  MotionSpec,
  MotionType,
  Prosody,
  ShapeKind,
  VisualSpec,
} from "@/types/emotion";

// Cross-modal mapping: emotion vector → visual specification.
//
// The rules are NOT in this file. They live in the language-agnostic spec at
// config/mapping_config.json (synced here via scripts/sync_mapping_config.py),
// the same file the Python backend reads. This module just interprets it, so
// the backend and frontend can never drift. Per-rule research citations live
// in the config's "citation" fields and in docs/mapping_rationale.md.

interface MotionCondition {
  category?: string;
  arousal_gt?: number;
  arousal_lt?: number;
  valence_gt?: number;
  valence_lt?: number;
}

interface MappingConfig {
  shape: {
    by_category: Record<string, string>;
    default: string;
  };
  color: {
    hue_by_category: Record<string, number>;
    neutral: HSLColor;
    saturation: { base: number; arousal_gain: number; min: number; max: number };
    lightness: {
      base: number;
      valence_gain: number;
      arousal_gain: number;
      min: number;
      max: number;
    };
  };
  size: { base: number; arousal_gain: number; min: number; max: number };
  motion: {
    rules: { when: MotionCondition; motion: MotionSpec }[];
    default: MotionSpec;
  };
  prosody_modulation?: {
    enabled?: boolean;
    instability: {
      jitter_min: number;
      jitter_max: number;
      shimmer_min: number;
      shimmer_max: number;
      amplitude_gain: number;
      speed_gain: number;
    };
    intensity: { db_min: number; db_max: number; size_gain: number };
    speech_rate: { rate_min: number; rate_max: number; speed_gain: number };
  };
  confidence?: {
    enabled?: boolean;
    conf_min: number;
    conf_max: number;
    floor: number;
  };
}

const config = rawConfig as unknown as MappingConfig;

// The base visual comes from the emotion vector (wav2vec2). When measured
// prosody (PRAAT features) is supplied, prosody_modulation nudges motion/size
// from the interpretable acoustics — mirrors backend/mapping/engine.py exactly.
export function mapEmotionToVisual(
  emotion: Emotion,
  prosody?: Prosody | null,
): VisualSpec {
  let visual: VisualSpec = {
    shape: pickShape(emotion.category),
    color: pickColor(emotion.category, emotion.valence, emotion.arousal),
    size: pickSize(emotion.arousal),
    motion: pickMotion(emotion.category, emotion.valence, emotion.arousal),
  };
  if (prosody) visual = applyProsody(visual, prosody);
  if (emotion.confidence != null) visual = applyConfidence(visual, emotion.confidence);
  return visual;
}

// When the classifier is unsure, express less: mute saturation, shrink size,
// calm motion — instead of asserting a possibly-wrong emotion.
function applyConfidence(visual: VisualSpec, confidence: number): VisualSpec {
  const cc = config.confidence;
  if (!cc || !cc.enabled) return visual;
  const f = clamp(
    (confidence - cc.conf_min) / (cc.conf_max - cc.conf_min),
    cc.floor,
    1,
  );
  const sizeMin = config.size.min;
  return {
    shape: visual.shape,
    color: { ...visual.color, s: visual.color.s * f },
    size: sizeMin + (visual.size - sizeMin) * f,
    motion: { ...visual.motion, amplitude: visual.motion.amplitude * f },
  };
}

function norm(x: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  return clamp((x - lo) / (hi - lo), 0, 1);
}

function applyProsody(visual: VisualSpec, prosody: Prosody): VisualSpec {
  const pm = config.prosody_modulation;
  if (!pm || !pm.enabled) return visual;

  const motion: MotionSpec = { ...visual.motion };

  const inst = pm.instability;
  const jit = norm(prosody.jitter_local ?? 0, inst.jitter_min, inst.jitter_max);
  const shi = norm(prosody.shimmer_local ?? 0, inst.shimmer_min, inst.shimmer_max);
  const instability = (jit + shi) / 2;
  motion.amplitude = clamp(
    motion.amplitude * (1 + instability * inst.amplitude_gain),
    0,
    1,
  );
  motion.speed = clamp(motion.speed * (1 + instability * inst.speed_gain), 0, 1.5);

  const sr = pm.speech_rate;
  const rate = norm(prosody.speech_rate_approx ?? 0, sr.rate_min, sr.rate_max);
  motion.speed = clamp(motion.speed * (1 + rate * sr.speed_gain), 0, 1.5);

  const inten = pm.intensity;
  const loud = norm(prosody.intensity_mean ?? 0, inten.db_min, inten.db_max);
  const size = clamp(visual.size + loud * inten.size_gain, 0, 1);

  return { shape: visual.shape, color: visual.color, size, motion };
}

function pickShape(category: string): ShapeKind {
  return (config.shape.by_category[category] ?? config.shape.default) as ShapeKind;
}

function pickColor(
  category: string,
  valence: number,
  arousal: number,
): HSLColor {
  const c = config.color;
  if (category === "neutral") return { ...c.neutral };
  const h = c.hue_by_category[category] ?? 0;
  const s = clamp(
    c.saturation.base + arousal01(arousal) * c.saturation.arousal_gain,
    c.saturation.min,
    c.saturation.max,
  );
  const l = clamp(
    c.lightness.base +
      valence * c.lightness.valence_gain +
      arousal * c.lightness.arousal_gain,
    c.lightness.min,
    c.lightness.max,
  );
  return { h, s, l };
}

function pickSize(arousal: number): number {
  const s = config.size;
  return clamp(s.base + arousal01(arousal) * s.arousal_gain, s.min, s.max);
}

// Map signed arousal [-1,+1] → [0,1] monotonically (calm→0, excited→1).
// Fixes the old |arousal| formula that made very calm states render large/vivid.
function arousal01(arousal: number): number {
  return (arousal + 1) / 2;
}

function matches(
  when: MotionCondition,
  category: string,
  valence: number,
  arousal: number,
): boolean {
  if (when.category !== undefined && when.category !== category) return false;
  if (when.arousal_gt !== undefined && !(arousal > when.arousal_gt)) return false;
  if (when.arousal_lt !== undefined && !(arousal < when.arousal_lt)) return false;
  if (when.valence_gt !== undefined && !(valence > when.valence_gt)) return false;
  if (when.valence_lt !== undefined && !(valence < when.valence_lt)) return false;
  return true;
}

function pickMotion(
  category: string,
  valence: number,
  arousal: number,
): MotionSpec {
  for (const rule of config.motion.rules) {
    if (matches(rule.when, category, valence, arousal)) {
      return { ...rule.motion, type: rule.motion.type as MotionType };
    }
  }
  return { ...config.motion.default };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
