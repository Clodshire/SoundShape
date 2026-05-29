import rawConfig from "@/config/mapping_config.json";
import type {
  Emotion,
  HSLColor,
  MotionSpec,
  MotionType,
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
}

const config = rawConfig as unknown as MappingConfig;

export function mapEmotionToVisual(emotion: Emotion): VisualSpec {
  return {
    shape: pickShape(emotion.category),
    color: pickColor(emotion.category, emotion.valence, emotion.arousal),
    size: pickSize(emotion.arousal),
    motion: pickMotion(emotion.category, emotion.valence, emotion.arousal),
  };
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
    c.saturation.base + Math.abs(arousal) * c.saturation.arousal_gain,
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
  return clamp(
    s.base + Math.abs(arousal) * s.arousal_gain,
    s.min,
    s.max,
  );
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
