import type {
  Emotion,
  HSLColor,
  MotionSpec,
  ShapeKind,
  VisualSpec,
} from "@/types/emotion";

// Cross-modal mapping: emotion vector → visual specification.
//
// Rules below are stubs grounded in the literature; Phase 5 will replace
// the magic constants with a tunable JSON config + per-rule citations.
//
//   SHAPE  — Kiki/Bouba (Köhler 1929; Ramachandran & Hubbard 2001)
//            jagged ↔ high-arousal negative · round ↔ low-arousal / positive
//   COLOR  — Hupka et al. 1997 cross-cultural color-emotion mapping
//            red=anger · blue=sadness · yellow=joy (consistent across 6 cultures)
//   SAT    — Russell 1980 circumplex: saturation scales with arousal
//   SIZE   — proportional to |arousal|
//   MOTION — driven by valence × arousal quadrant (Phase 2 will add jitter/shimmer)

export function mapEmotionToVisual(emotion: Emotion): VisualSpec {
  return {
    shape: pickShape(emotion),
    color: pickColor(emotion),
    size: pickSize(emotion),
    motion: pickMotion(emotion),
  };
}

function pickShape(e: Emotion): ShapeKind {
  switch (e.category) {
    case "anger":
      return "jagged_star";
    case "fear":
      return "trembling_spikes";
    case "joy":
      return "expanding_burst";
    case "surprise":
      return "expanding_burst";
    case "sadness":
      return "flowing_wave";
    case "resignation":
      return "drooping_ellipse";
    case "sincerity":
      return "soft_circle";
    case "sarcasm":
      // Intentionally angry-shaped but coolly colored — the visual mismatch
      // is the point: it's anger wearing a calm mask.
      return "jagged_star";
    case "neutral":
      return "simple_circle";
  }
}

function pickColor(e: Emotion): HSLColor {
  // Hue is mostly category-driven (Hupka findings are categorical),
  // with valence fine-tuning lightness and arousal driving saturation.
  let h: number;
  switch (e.category) {
    case "anger":
      h = 0; // red
      break;
    case "sadness":
      h = 220; // blue
      break;
    case "joy":
      h = 50; // warm yellow
      break;
    case "fear":
      h = 270; // dark violet
      break;
    case "surprise":
      h = 45; // bright yellow
      break;
    case "resignation":
      h = 230; // muted blue-gray
      break;
    case "sincerity":
      h = 80; // warm yellow-green
      break;
    case "sarcasm":
      h = 200; // cool blue — visually "off" from the angry shape
      break;
    case "neutral":
      return { h: 0, s: 0, l: 55 }; // gray
  }
  const s = clamp(40 + Math.abs(e.arousal) * 50, 25, 95);
  const l = clamp(50 - e.valence * 8 + e.arousal * 5, 35, 70);
  return { h, s, l };
}

function pickSize(e: Emotion): number {
  return clamp(0.3 + Math.abs(e.arousal) * 0.55, 0.2, 0.95);
}

function pickMotion(e: Emotion): MotionSpec {
  const hiArousal = e.arousal > 0.4;
  const loArousal = e.arousal < -0.2;
  const negValence = e.valence < 0;

  if (hiArousal && negValence) {
    return { type: "shake", amplitude: 0.7, speed: 0.9 };
  }
  if (e.category === "fear") {
    return { type: "tremor", amplitude: 0.5, speed: 1.0 };
  }
  if (hiArousal && !negValence) {
    return { type: "pulse", amplitude: 0.55, speed: 0.7 };
  }
  if (loArousal && negValence && e.category === "sadness") {
    return { type: "slow_drift", amplitude: 0.35, speed: 0.25 };
  }
  if (e.category === "resignation") {
    return { type: "sink", amplitude: 0.4, speed: 0.25 };
  }
  if (e.category === "sincerity") {
    return { type: "pulse", amplitude: 0.22, speed: 0.4 };
  }
  return { type: "still", amplitude: 0, speed: 0 };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
