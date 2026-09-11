import type { Prosody, TimelineFrame } from "@/types/emotion";

// Hardcoded demo timeline — the "괜찮아" four-tone scene.
// Same word, four different emotional readings. The standard-captioning
// failure case the README opens with: text alone collapses all four into
// the same line, but the meaning shifts entirely.
//
// ── About the prosody numbers on these frames ──
//
// They are ILLUSTRATIVE, not measured. There is no recording of this scene in
// the repo, so nothing here came out of PRAAT. They are held to the ranges the
// mapping config was fitted on (see mapping_config.json → measured_arousal:
// f0_mean 90–380 Hz, intensity 0–75 dB, f0_range 60–450 Hz, speech rate 25–85
// voiced frames/s) and to the direction the literature it cites predicts for
// each reading — Banse & Scherer (1996), Juslin & Laukka (2003): arousal
// raises F0 level, F0 range, intensity and rate together; agitation raises
// jitter and shimmer independently of arousal.
//
// They are here because without them the demo could not show the product. With
// `prosody` absent, the hybrid/full-AI switch has nothing to re-source and sits
// disabled, and the analysis panel can only ever show the classifier's own
// output — so the landing state silently hid every measured channel. Anything
// a viewer uploads populates these same fields for real, from the backend.
//
// The UI labels this scene as illustrative (see the `SYNTHETIC` flag below);
// do not remove that label without replacing these numbers with real ones.
// Phase 4 replaces this whole file with backend-produced JSON.

/** True while the demo scene's prosody is illustrative rather than measured. */
export const DEMO_PROSODY_IS_SYNTHETIC = true;

// A female Korean speaker at a conversational baseline (~200 Hz). Fields the
// backend emits are all filled so the demo exercises the same code path as a
// real upload — no `prosody?.x ?? fallback` branches that only the demo takes.
function prosody(p: {
  duration: number;
  f0_mean: number;
  f0_std: number;
  f0_min: number;
  f0_max: number;
  intensity_mean: number;
  intensity_std: number;
  intensity_min: number;
  intensity_max: number;
  jitter_local: number;
  shimmer_local: number;
  hnr_mean: number;
  voiced_ratio: number;
  speech_rate_approx: number;
}): Prosody {
  return { ...p, f0_range: p.f0_max - p.f0_min };
}

export const DEMO_TIMELINE: TimelineFrame[] = [
  {
    // Quiet, pitch falling away, breathy — the reading that says the opposite
    // of the words. Low F0 and low intensity, but jitter already elevated:
    // a voice that is holding something back is not a steady voice.
    t: 0,
    duration: 2.5,
    text: "괜찮아...",
    emotion: {
      category: "sadness",
      valence: -0.55,
      arousal: -0.35,
      confidence: 0.81,
    },
    words: [
      { word: "괜찮아...", start: 0.35, end: 1.9 },
    ],
    prosody: prosody({
      duration: 2.5,
      f0_mean: 168,
      f0_std: 14,
      f0_min: 142,
      f0_max: 197,
      intensity_mean: 57.4,
      intensity_std: 4.1,
      intensity_min: 44.0,
      intensity_max: 63.8,
      jitter_local: 0.018,
      shimmer_local: 0.072,
      hnr_mean: 11.6,
      voiced_ratio: 0.58,
      speech_rate_approx: 34,
    }),
  },
  {
    // The flattest line in the scene. Narrowest F0 range, lowest rate — giving
    // up sounds like a voice that has stopped modulating.
    t: 2.5,
    duration: 2.5,
    text: "정말 괜찮아.",
    emotion: {
      category: "resignation",
      valence: -0.4,
      arousal: -0.55,
      confidence: 0.74,
    },
    words: [
      { word: "정말", start: 2.75, end: 3.25 },
      { word: "괜찮아.", start: 3.3, end: 4.5 },
    ],
    prosody: prosody({
      duration: 2.5,
      f0_mean: 151,
      f0_std: 9,
      f0_min: 134,
      f0_max: 172,
      intensity_mean: 54.1,
      intensity_std: 3.0,
      intensity_min: 43.5,
      intensity_max: 59.2,
      jitter_local: 0.012,
      shimmer_local: 0.054,
      hnr_mean: 13.9,
      voiced_ratio: 0.61,
      speech_rate_approx: 29,
    }),
  },
  {
    // Warmer and steadier — the one reading that means what it says. Note the
    // lowest jitter and highest HNR of the four: sincerity is a clean voice.
    // Confidence is lowest here (0.62) because sincerity and resignation are
    // acoustically close; the renderer expresses that doubt rather than hiding it.
    t: 5,
    duration: 2.5,
    text: "...괜찮다고.",
    emotion: {
      category: "sincerity",
      valence: 0.25,
      arousal: -0.15,
      confidence: 0.62,
    },
    words: [
      { word: "...괜찮다고.", start: 5.4, end: 6.8 },
    ],
    prosody: prosody({
      duration: 2.5,
      f0_mean: 196,
      f0_std: 22,
      f0_min: 158,
      f0_max: 251,
      intensity_mean: 62.3,
      intensity_std: 4.6,
      intensity_min: 48.1,
      intensity_max: 68.9,
      jitter_local: 0.009,
      shimmer_local: 0.047,
      hnr_mean: 16.2,
      voiced_ratio: 0.67,
      speech_rate_approx: 42,
    }),
  },
  {
    // Everything rises at once — F0, range, intensity, rate — and jitter and
    // shimmer go with it. This is the frame where hybrid and full-AI rendering
    // visibly disagree, which is the point of leaving the switch live.
    t: 7.5,
    duration: 2.5,
    text: "괜찮다고!!",
    emotion: {
      category: "anger",
      valence: -0.7,
      arousal: 0.85,
      confidence: 0.89,
    },
    words: [
      { word: "괜찮다고!!", start: 7.7, end: 9.1 },
    ],
    prosody: prosody({
      duration: 2.5,
      f0_mean: 311,
      f0_std: 58,
      f0_min: 189,
      f0_max: 457,
      intensity_mean: 74.2,
      intensity_std: 7.9,
      intensity_min: 55.3,
      intensity_max: 82.1,
      jitter_local: 0.031,
      shimmer_local: 0.118,
      hnr_mean: 7.4,
      voiced_ratio: 0.74,
      speech_rate_approx: 71,
    }),
  },
];

export const DEMO_TIMELINE_DURATION = 10;

export function getCurrentFrame(
  timeline: TimelineFrame[],
  t: number,
): TimelineFrame | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (t >= timeline[i].t) return timeline[i];
  }
  return null;
}
