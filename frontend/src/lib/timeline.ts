import type { TimelineFrame } from "@/types/emotion";

// Hardcoded demo timeline — the "괜찮아" four-tone scene.
// Same word, four different emotional readings. The standard-captioning
// failure case the README opens with: text alone collapses all four into
// the same line, but the meaning shifts entirely.
//
// Phase 4 will replace this with real backend-produced JSON.
export const DEMO_TIMELINE: TimelineFrame[] = [
  {
    t: 0,
    duration: 2.5,
    text: "괜찮아...",
    emotion: {
      category: "sadness",
      valence: -0.55,
      arousal: -0.35,
      confidence: 0.81,
    },
  },
  {
    t: 2.5,
    duration: 2.5,
    text: "정말 괜찮아.",
    emotion: {
      category: "resignation",
      valence: -0.4,
      arousal: -0.55,
      confidence: 0.74,
    },
  },
  {
    t: 5,
    duration: 2.5,
    text: "...괜찮다고.",
    emotion: {
      category: "sincerity",
      valence: 0.25,
      arousal: -0.15,
      confidence: 0.62,
    },
  },
  {
    t: 7.5,
    duration: 2.5,
    text: "괜찮다고!!",
    emotion: {
      category: "anger",
      valence: -0.7,
      arousal: 0.85,
      confidence: 0.89,
    },
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
