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
  rendering?: { mode?: RenderMode };
  measured_arousal?: {
    components: {
      key: string;
      weight: number;
      abs_min: number;
      abs_max: number;
      rel_span: number;
    }[];
  };
  hybrid?: {
    size: { base: number; gain: number; min: number; max: number };
    saturation: { base: number; gain: number; min: number; max: number };
    motion: {
      amplitude: { base: number; gain: number; min: number; max: number };
      speed: { base: number; gain: number; min: number; max: number };
    };
  };
}

export type RenderMode = "full_ai" | "hybrid";

/** Per-viewer channel gains from the calibration test. */
export type ChannelWeights = Partial<
  Record<"saturation" | "lightness" | "size" | "motion", number>
>;

const config = rawConfig as unknown as MappingConfig;

/** The mode the config ships with — what a viewer sees before touching anything. */
export const DEFAULT_RENDER_MODE: RenderMode =
  config.rendering?.mode ?? "full_ai";

// Two rendering modes, mirroring backend/mapping/engine.py exactly.
//
//   full_ai  the historical behaviour — the emotion vector sets every channel
//            and prosody_modulation then nudges size/motion.
//   hybrid   size, saturation and motion are re-sourced from the measurement
//            itself; shape, hue and lightness stay with the classifier because
//            category and valence are the parts that genuinely need inference.
//
// `reference` is an optional per-video prosody baseline. With it, measured
// arousal is scored as a deviation from that baseline rather than against an
// absolute range — necessary because PRAAT intensity is relative to the
// recording level, not to the voice.
export function mapEmotionToVisual(
  emotion: Emotion,
  prosody?: Prosody | null,
  reference?: Prosody | null,
  mode?: RenderMode,
  weights?: ChannelWeights | null,
): VisualSpec {
  let visual: VisualSpec = {
    shape: pickShape(emotion.category),
    color: pickColor(emotion.category, emotion.valence, emotion.arousal),
    size: pickSize(emotion.arousal),
    motion: pickMotion(emotion.category, emotion.valence, emotion.arousal),
  };
  const resolved = mode ?? config.rendering?.mode ?? "full_ai";
  const hybrid = resolved === "hybrid" && !!prosody;

  if (hybrid) visual = applyHybrid(visual, prosody as Prosody, reference);
  else if (prosody) visual = applyProsody(visual, prosody);

  if (emotion.confidence != null) {
    visual = applyConfidence(visual, emotion.confidence, hybrid);
  }
  if (weights) visual = applyWeights(visual, weights);
  return visual;
}

// Move a value away from (gain > 1) or toward (gain < 1) a midpoint. Scaling
// the DISTANCE is what makes a gain mean "how far apart do these levels sit" —
// scaling the value itself would shift the average instead of the contrast,
// and a viewer who cannot tell two levels apart still could not.
function stretch(
  value: number,
  mid: number,
  gain: number,
  lo: number,
  hi: number,
): number {
  return clamp(mid + (value - mid) * gain, lo, hi);
}

// Per-viewer channel gains. Only channels with a RANGE can be weighted: hue and
// shape are categorical, so calibration compensates for them by widening the
// others instead. Which emotion maps to which hue or shape never changes.
function applyWeights(visual: VisualSpec, weights: ChannelWeights): VisualSpec {
  const color = { ...visual.color };
  const motion: MotionSpec = { ...visual.motion };
  let size = visual.size;

  const satW = weights.saturation ?? 1;
  if (satW !== 1 && color.s > 0) {
    const sc = config.color.saturation;
    color.s = stretch(color.s, (sc.min + sc.max) / 2, satW, sc.min, sc.max);
  }

  const lightW = weights.lightness ?? 1;
  if (lightW !== 1) {
    const lc = config.color.lightness;
    color.l = stretch(color.l, lc.base, lightW, lc.min, lc.max);
  }

  const sizeW = weights.size ?? 1;
  if (sizeW !== 1) {
    const sz = config.size;
    size = stretch(size, (sz.min + sz.max) / 2, sizeW, sz.min, sz.max);
  }

  const motionW = weights.motion ?? 1;
  if (motionW !== 1) {
    // Motion has a natural floor at rest, so it scales from zero rather than
    // from a midpoint — "more movement" is the whole scale.
    motion.amplitude = clamp(motion.amplitude * motionW, 0, 1);
    motion.speed = clamp(motion.speed * motionW, 0, 1.5);
  }

  return { shape: visual.shape, color, size, motion };
}

// When the classifier is unsure, express less: mute saturation, shrink size,
// calm motion — instead of asserting a possibly-wrong emotion.
//
// In hybrid mode this does NOTHING, deliberately. Size and motion are
// measurements there, and saturation already means measured arousal — dimming
// it for low confidence made a calm voice and an unsure classifier look the
// same. Hybrid expresses doubt as reduced opacity in the renderer instead.
function applyConfidence(
  visual: VisualSpec,
  confidence: number,
  hybrid = false,
): VisualSpec {
  const cc = config.confidence;
  if (!cc || !cc.enabled) return visual;
  const f = clamp(
    (confidence - cc.conf_min) / (cc.conf_max - cc.conf_min),
    cc.floor,
    1,
  );
  if (hybrid) return visual;
  const color = { ...visual.color, s: visual.color.s * f };
  const sizeMin = config.size.min;
  return {
    shape: visual.shape,
    color,
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

// Arousal read off the acoustics, in [0,1]. No classifier involved.
//
// With a `reference` each component is scored as a deviation from that
// baseline (rel_span is the full-scale deviation); without one it is scored
// against the absolute range. Weights and ranges were fitted on RAVDESS, not
// guessed — see measured_arousal._doc in the config.
function measuredArousal(prosody: Prosody, reference?: Prosody | null): number {
  const ma = config.measured_arousal;
  if (!ma) return 0;
  const row = prosody as unknown as Record<string, number | undefined>;
  const ref = (reference ?? undefined) as unknown as
    | Record<string, number | undefined>
    | undefined;
  let total = 0;
  let weight = 0;
  for (const comp of ma.components) {
    const value = row[comp.key];
    if (value == null) continue;
    const base = ref?.[comp.key];
    const score =
      base == null
        ? norm(value, comp.abs_min, comp.abs_max)
        : norm(value - base, -comp.rel_span, comp.rel_span);
    total += score * comp.weight;
    weight += comp.weight;
  }
  // Renormalise so a missing feature reweights the rest instead of dragging
  // the result toward zero.
  return weight ? total / weight : 0;
}

// Vocal instability (jitter + shimmer). Deliberately kept out of measured
// arousal: on RAVDESS these two score .46 AUC against the normal/strong
// intensity label, i.e. they carry no arousal signal. What they do carry is
// tremor, which is what motion amplitude shows.
function instability(prosody: Prosody): number {
  const inst = config.prosody_modulation!.instability;
  const jit = norm(prosody.jitter_local ?? 0, inst.jitter_min, inst.jitter_max);
  const shi = norm(
    prosody.shimmer_local ?? 0,
    inst.shimmer_min,
    inst.shimmer_max,
  );
  return (jit + shi) / 2;
}

// Re-source size, saturation and motion from the measurement itself. Shape,
// hue, lightness and motion.type are left exactly as the classifier set them,
// so everything written here stays truthful even when the label is wrong.
function applyHybrid(
  visual: VisualSpec,
  prosody: Prosody,
  reference?: Prosody | null,
): VisualSpec {
  const hb = config.hybrid;
  if (!hb) return visual;

  const arousalM = measuredArousal(prosody, reference);

  const size = clamp(
    hb.size.base + arousalM * hb.size.gain,
    hb.size.min,
    hb.size.max,
  );

  // A neutral reading is rendered as grey (hue 0, saturation 0). Saturating it
  // from measured arousal would paint it red, so neutral is left alone.
  const color = { ...visual.color };
  if (color.s > 0) {
    color.s = clamp(
      hb.saturation.base + arousalM * hb.saturation.gain,
      hb.saturation.min,
      hb.saturation.max,
    );
  }

  const amp = hb.motion.amplitude;
  const spd = hb.motion.speed;
  const rate = config.prosody_modulation!.speech_rate;
  const motion: MotionSpec = {
    ...visual.motion,
    amplitude: clamp(
      amp.base + instability(prosody) * amp.gain,
      amp.min,
      amp.max,
    ),
    speed: clamp(
      spd.base +
        norm(prosody.speech_rate_approx ?? 0, rate.rate_min, rate.rate_max) *
          spd.gain,
      spd.min,
      spd.max,
    ),
  };

  return { shape: visual.shape, color, size, motion };
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

