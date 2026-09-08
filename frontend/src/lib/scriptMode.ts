// Script mode: play a hand-written .srt (with optional [emotion] tags) instead
// of letting the model interpret the audio. Each cue becomes a timeline frame —
// text + an emotion derived from its tag — and the visual is computed with the
// same mapEmotionToVisual the rest of the app uses. Lets a presenter control
// exactly which emotion shows (e.g. force sarcasm on a line the acoustic model
// would read as upbeat).

import { mapEmotionToVisual } from "@/lib/mapping";
import type { Emotion, EmotionCategory, TimelineFrame } from "@/types/emotion";

// Tag → emotion vector. Korean tags (matching the slide terminology) and the
// English category names both work. valence/arousal are chosen so the visual
// is distinct and research-consistent.
const TAG_TO_EMOTION: Record<string, Emotion> = {
  // Korean
  "비꼼": { category: "sarcasm", valence: -0.35, arousal: 0.15 },
  "진심": { category: "sincerity", valence: 0.5, arousal: -0.1 },
  "위로": { category: "sincerity", valence: 0.4, arousal: -0.2 },
  "분노": { category: "anger", valence: -0.6, arousal: 0.7 },
  "짜증": { category: "anger", valence: -0.4, arousal: 0.45 },
  "슬픔": { category: "sadness", valence: -0.5, arousal: -0.3 },
  "체념": { category: "resignation", valence: -0.4, arousal: -0.4 },
  "놀람": { category: "surprise", valence: 0.1, arousal: 0.7 },
  "기쁨": { category: "joy", valence: 0.6, arousal: 0.5 },
  "공포": { category: "fear", valence: -0.5, arousal: 0.6 },
  "중립": { category: "neutral", valence: 0, arousal: 0 },
  // English
  sarcasm: { category: "sarcasm", valence: -0.35, arousal: 0.15 },
  sincerity: { category: "sincerity", valence: 0.5, arousal: -0.1 },
  comfort: { category: "sincerity", valence: 0.4, arousal: -0.2 },
  anger: { category: "anger", valence: -0.6, arousal: 0.7 },
  irritation: { category: "anger", valence: -0.4, arousal: 0.45 },
  sadness: { category: "sadness", valence: -0.5, arousal: -0.3 },
  resignation: { category: "resignation", valence: -0.4, arousal: -0.4 },
  surprise: { category: "surprise", valence: 0.1, arousal: 0.7 },
  joy: { category: "joy", valence: 0.6, arousal: 0.5 },
  fear: { category: "fear", valence: -0.5, arousal: 0.6 },
  neutral: { category: "neutral", valence: 0, arousal: 0 },
};

const DEFAULT_EMOTION: Emotion = { category: "neutral", valence: 0, arousal: 0 };

function tsToSeconds(ts: string): number {
  // "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
  const m = ts.trim().match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4]) / 1000
  );
}

export interface ScriptCue {
  t: number;
  duration: number;
  text: string;
  emotion: Emotion;
}

/** Parse an .srt whose cue text may start with `[tag]` (Korean or English). */
export function parseScriptSrt(srt: string): ScriptCue[] {
  const blocks = srt.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const cues: ScriptCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [a, b] = timeLine.split("-->");
    const start = tsToSeconds(a);
    const end = tsToSeconds(b);
    // Text = every line after the timing line (skip the index line).
    const idx = lines.indexOf(timeLine);
    let text = lines.slice(idx + 1).join(" ").trim();

    let emotion = DEFAULT_EMOTION;
    const tagMatch = text.match(/^\[\s*([^\]]+?)\s*\]\s*/);
    if (tagMatch) {
      const tag = tagMatch[1].trim();
      emotion = TAG_TO_EMOTION[tag] ?? TAG_TO_EMOTION[tag.toLowerCase()] ?? DEFAULT_EMOTION;
      text = text.slice(tagMatch[0].length).trim(); // strip the tag from the caption
    }
    cues.push({ t: start, duration: Math.max(0.1, end - start), text, emotion });
  }
  return cues.sort((x, y) => x.t - y.t);
}

/** Build a renderer-ready timeline (with precomputed visuals) from an .srt. */
export function buildTimelineFromScript(srt: string): {
  timeline: TimelineFrame[];
  totalDuration: number;
} {
  const cues = parseScriptSrt(srt);
  const timeline: TimelineFrame[] = cues.map((c) => ({
    t: c.t,
    duration: c.duration,
    text: c.text,
    emotion: c.emotion,
    visual: mapEmotionToVisual(c.emotion),
  }));
  const totalDuration = cues.length
    ? Math.max(...cues.map((c) => c.t + c.duration))
    : 0;
  return { timeline, totalDuration };
}

export const KNOWN_TAGS: EmotionCategory[] = [
  "sarcasm",
  "sincerity",
  "anger",
  "sadness",
  "resignation",
  "surprise",
  "joy",
  "fear",
  "neutral",
];
