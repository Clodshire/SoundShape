import type { Emotion, TimelineFrame } from "@/types/emotion";

// The four tones of the public site (디자인 목업에서 확정된 체계).
// `speed` is the base animation period in seconds: anger fast and rough,
// comfort slow and soft. The waveform bars multiply it per bar.
export type ToneId = "comfort" | "anger" | "sarcasm" | "resignation";

export interface Tone {
  id: ToneId;
  label: string;
  color: string;
  speed: number;
}

// 분노가 가장 빠르고 위로가 가장 느리다는 순서는 그대로 두되, 전체를 느리게
// 잡았다. 예전 값(분노 0.8초)에서는 막대 하나가 0.18초마다 뛰어서 —
// 눈이 따라가지 못하고 예시가 읽히지 않았다.
export const TONES: Record<ToneId, Tone> = {
  comfort: { id: "comfort", label: "위로", color: "#2F7A4D", speed: 3.4 },
  anger: { id: "anger", label: "분노", color: "#D0402A", speed: 1.9 },
  sarcasm: { id: "sarcasm", label: "비꼼", color: "#A66A12", speed: 2.5 },
  resignation: { id: "resignation", label: "체념", color: "#5B5B66", speed: 3.0 },
};

export const TONE_ORDER: ToneId[] = ["comfort", "anger", "sarcasm", "resignation"];

// Backend emotion → one of the four tones.
//
// The models name more categories than the site shows (joy, sadness, fear,
// surprise, neutral…) and none of them predicts sarcasm directly, so this is
// the single place where that gap is bridged:
//   · 분노 — an angry/disgusted voice whose (text-fused) valence stays negative.
//   · 비꼼 — an angry-sounding voice over positive words (valence > 0.2 after
//     text fusion): "괜찮아" said through the teeth. Also the backend's own
//     "sarcasm" label, should a future classifier emit it.
//   · 체념 — sadness, fear, resignation, and flat-negative neutral speech.
//   · 위로 — everything warm or calm.
export function toneForEmotion(e: Emotion | undefined): ToneId {
  if (!e) return "comfort";
  const c = e.category as string;
  const v = e.valence ?? 0;
  const a = e.arousal ?? 0;
  if (c === "sarcasm") return "sarcasm";
  if (c === "anger" || c === "disgust") return v > 0.2 ? "sarcasm" : "anger";
  if (c === "sadness" || c === "fear" || c === "resignation") return "resignation";
  if (c === "surprise") return v < -0.1 ? "sarcasm" : "comfort";
  // joy · sincerity · neutral — fall back to the V/A position.
  if (v < -0.1 && a > 0.35) return "anger";
  if (v < -0.1) return "resignation";
  return "comfort";
}

// At time t (seconds): the line being spoken (null between lines) and the
// most recent line that has started — its tone holds through the pause so
// the color does not flicker back to a default between sentences.
export function lineAt(
  segments: TimelineFrame[],
  t: number,
): { current: TimelineFrame | null; last: TimelineFrame | null } {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.t <= t) {
      const speaking = t < s.t + Math.max(s.duration, 0.4);
      return { current: speaking ? s : null, last: s };
    }
  }
  return { current: null, last: null };
}
