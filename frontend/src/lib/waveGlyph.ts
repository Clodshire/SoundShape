// Static SVG silhouette of the emotion field, for places that need to SHOW the
// visual language without running it: the legend, report figures, print.
//
// Why this exists rather than a hand-drawn icon set: the renderer does not draw
// a star for anger and an ellipse for resignation. It draws a waveform band and
// the `shape` channel reaches the screen as how POINTED that wave's peaks are
// (emotionField.ts → SHARPNESS_BY_SHAPE). A legend of star and ellipse icons
// would therefore be teaching a vocabulary the product never speaks. This
// mirrors the shader's own wave math — same sharpen(), same harmonics, same
// envelope, same constants imported from the renderer — so the legend and the
// stage cannot drift apart.
//
// Differences from the shader, both deliberate:
//   · time is frozen at t = 0, so the silhouette is reproducible
//   · fbm turbulence is replaced by a deterministic ripple, because a static
//     frame of real noise reads as a mistake rather than as roughness
//   · the envelope and span are adjustable (see CHIP_GLYPH), because the
//     shader's framing is tuned for a band hundreds of pixels wide

import { SHARPNESS_BY_SHAPE } from "@/lib/emotionField";
import type { MotionType, VisualSpec } from "@/types/emotion";

/** Motion-type constants, mirroring `uniformsFor` in emotionField.ts. */
const BY_MOTION: Record<MotionType, { turb: number; edgeFreq: number }> = {
  shake: { turb: 0.95, edgeFreq: 7 },
  tremor: { turb: 1.0, edgeFreq: 9 },
  pulse: { turb: 0.5, edgeFreq: 5 },
  slow_drift: { turb: 0.28, edgeFreq: 2 },
  sink: { turb: 0.3, edgeFreq: 2 },
  still: { turb: 0.2, edgeFreq: 3 },
};

/** The stage's own framing: full horizontal span, tight Gaussian envelope. */
const STAGE_SPAN = 2.4;
const STAGE_ENV = 3.4;

/**
 * Chip framing, for a glyph an inch wide.
 *
 * At stage settings the envelope collapses every emotion into the same small
 * blob in the middle of a legend chip, and the one thing the chip exists to
 * teach — angular versus rounded — is the first thing to go. Widening the span
 * and flattening the envelope shows more of the same wave instead of a
 * different wave: several peaks at their true pointedness, so anger reads as
 * needles and sadness as swells. Values chosen by rendering the whole
 * vocabulary across a grid and picking the row where all seven stay distinct.
 */
export const CHIP_GLYPH: GlyphOptions = { span: 3.4, envK: 0.9, headroom: 0.27 };

export interface GlyphOptions {
  /** Horizontal extent of shader space to draw, centred on 0. */
  span?: number;
  /** Gaussian envelope tightness — the shader uses 3.4. */
  envK?: number;
  /** Wave half-height that maps to the full box height. Smaller = taller wave. */
  headroom?: number;
}

/** `sharpen` from the fragment shader: reshape a wave without changing its height. */
function sharpen(x: number, k: number): number {
  return Math.sign(x) * Math.pow(Math.abs(x), k);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Half-height of the wave at horizontal position `x`, in the shader's own
 * coordinate space (x roughly -1.2…1.2, result roughly 0…0.5).
 */
function halfHeight(
  x: number,
  sharp: number,
  turb: number,
  freq: number,
  amp: number,
  envK: number,
) {
  // Gaussian envelope — the movement comes from one place near the middle.
  const env = Math.exp(-x * x * envK);

  // Standing in for the shader's fbm: a slow, non-repeating ripple that varies
  // the pointedness along x so neighbouring peaks differ.
  const local = 0.5 + 0.5 * Math.sin(x * 1.7 + 0.9);

  const k = 0.7 + (3.4 - 0.7) * clamp(sharp * 0.62 + turb * 0.55 + local * 0.3, 0, 1);

  let w =
    sharpen(Math.sin(x * freq), k) * 0.55 +
    sharpen(Math.sin(x * freq * 1.83), k * 0.8) * 0.28 +
    sharpen(Math.sin(x * freq * 0.41), k * 1.35) * 0.34;

  // Roughen the outline the way turbulence does, but deterministically.
  w += Math.sin(x * 6.1 + 1.3) * Math.sin(x * 2.7) * turb * 0.22;

  return Math.abs(w * env * amp);
}

/**
 * A closed, mirrored waveform path for `visual`, filling the box `w`×`h`.
 *
 * The path is centred vertically and drawn in user units, so it can be dropped
 * straight into `<svg viewBox={\`0 0 ${w} ${h}\`}>`.
 */
export function waveGlyphPath(
  visual: VisualSpec,
  w: number,
  h: number,
  opts: GlyphOptions = {},
): string {
  const { span = STAGE_SPAN, envK = STAGE_ENV, headroom = 0.62 } = opts;
  const sharp = SHARPNESS_BY_SHAPE[visual.shape] ?? 0.4;
  const m = BY_MOTION[visual.motion.type] ?? BY_MOTION.still;

  // Same chain as uniformsFor: amplitude scales with motion, brightness with size.
  const turb = clamp(m.turb * (0.55 + visual.motion.amplitude * 0.6), 0, 1.2) * 0.55 +
    clamp(m.turb * (0.5 + visual.motion.amplitude * 0.7), 0, 1) * 0.35;
  const freq = 2.1 + m.edgeFreq * 0.75;
  const bright = 0.55 + visual.size * 0.7;
  const amp = 0.15 + bright * 0.24;

  const STEPS = 200;
  const midY = h / 2;
  // Peak half-height lands well under 1 across the vocabulary, so the box is
  // scaled to the loudest of them — which leaves the quiet ones visibly
  // quieter, rather than normalising the size channel away.
  const yScale = h / headroom;

  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const u = i / STEPS; // 0…1
    const x = (u - 0.5) * span; // shader space
    const px = u * w;
    const hh = halfHeight(x, sharp, turb, freq, amp, envK) * yScale;
    top.push(`${px.toFixed(2)},${(midY - hh).toFixed(2)}`);
    bottom.push(`${px.toFixed(2)},${(midY + hh).toFixed(2)}`);
  }
  bottom.reverse();

  return `M${top.join("L")}L${bottom.join("L")}Z`;
}
