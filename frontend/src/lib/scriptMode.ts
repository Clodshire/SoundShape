// Script mode: play a hand-written .srt (with optional [emotion] tags) instead
// of letting the model interpret the audio. Each cue becomes a timeline frame —
// text + an emotion derived from its tag — and the visual is computed with the
// same mapEmotionToVisual the rest of the app uses. Lets a presenter control
// exactly which emotion shows (e.g. force sarcasm on a line the acoustic model
// would read as upbeat).

import { mapEmotionToVisual } from "@/lib/mapping";
import type { Emotion, EmotionCategory, TimelineFrame, VisualSpec } from "@/types/emotion";

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
  /** 실제 발화 길이(초). 자막은 duration 만큼, 손목은 이만큼 울린다. */
  speechDuration?: number;
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
    let speech: number | undefined;
    const tagMatch = text.match(/^\[\s*([^\]]+?)\s*\]\s*/);
    if (tagMatch) {
      // `[비꼼]` 또는 `[비꼼 71]` / `[비꼼 0.71]` — 뒤의 숫자는 화면에 띄울 확신도.
      // 배지뿐 아니라 매핑에도 넘어가므로, 낮게 적으면 제품과 똑같이 색이 흐려진다.
      const tag = tagMatch[1].trim();
      // `[비꼼]` · `[비꼼 82]` · `[비꼼 82 1.8]` — 세 번째 숫자는 실제 발화 길이(초).
      const withAll = tag.match(/^(.*?)[\s|,]+(\d{1,3}(?:\.\d+)?)\s*%?[\s|,]+(\d+(?:\.\d+)?)$/);
      const withConf = withAll
        ? [tag, withAll[1], withAll[2]]
        : tag.match(/^(.*?)[\s|,]+(\d{1,3}(?:\.\d+)?)\s*%?$/);
      if (withAll) speech = Number(withAll[3]);
      const name = (withConf ? withConf[1] : tag).trim();
      emotion = TAG_TO_EMOTION[name] ?? TAG_TO_EMOTION[name.toLowerCase()] ?? DEFAULT_EMOTION;
      if (withConf) {
        const n = Number(withConf[2]);
        // 1 보다 크면 퍼센트로 적은 것으로 본다. 0~1 을 벗어나면 잘라낸다.
        if (Number.isFinite(n)) {
          emotion = { ...emotion, confidence: Math.min(1, Math.max(0, n > 1 ? n / 100 : n)) };
        }
      }
      text = text.slice(tagMatch[0].length).trim(); // strip the tag from the caption
    }
    cues.push({
      t: start,
      duration: Math.max(0.1, end - start),
      text,
      emotion,
      speechDuration: speech,
    });
  }
  return cues.sort((x, y) => x.t - y.t);
}

/**
 * 시연용 선명도.
 *
 * 대본 재생에는 측정값이 없다. 그래서 hybrid 가 꺼지고, 낮은 확신도가 채도를
 * 바닥(40%)까지 끌어내린다. 실제로 비꼼은 39→25, 슬픔은 25→10 까지 떨어져
 * 밝은 화면이나 빔프로젝터에서는 거의 회색으로 보인다.
 *
 * 색상(hue)과 감정 간 순서는 그대로 두고 **채도의 바닥만 올린다.** 무채색인
 * 중립(s=0)은 건드리지 않는다 — 회색이 중립의 의미이기 때문이다.
 */
function vivid(v: VisualSpec): VisualSpec {
  if (v.color.s <= 0) return v;
  const s = Math.min(95, Math.max(50, 50 + (v.color.s / 95) * 45));
  return { ...v, color: { ...v.color, s } };
}

/** Build a renderer-ready timeline (with precomputed visuals) from an .srt. */
export function buildTimelineFromScript(
  srt: string,
  opts?: { vivid?: boolean },
): {
  timeline: TimelineFrame[];
  totalDuration: number;
} {
  const cues = parseScriptSrt(srt);
  const timeline: TimelineFrame[] = cues.map((c) => {
    const visual = mapEmotionToVisual(c.emotion);
    return {
      t: c.t,
      duration: c.duration,
      speechDuration: c.speechDuration,
      text: c.text,
      emotion: c.emotion,
      visual: opts?.vivid ? vivid(visual) : visual,
    };
  });
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
