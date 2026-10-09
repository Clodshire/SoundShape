import type { Emotion, TimelineFrame } from "@/types/emotion";

// 공개 페이지의 범례. **색은 `config/mapping_config.json` 에서 계산한 값**이고,
// 실제로 화면에 그려지는 색과 같아야 한다. 예전에는 위로·분노·비꼼·체념 네 가지로
// 따로 꾸며 두어, 범례의 초록·주황이 렌더러가 그리는 노랑·청록과 달랐다 —
// 범례를 보고 화면을 읽는 사람에게는 그게 그냥 틀린 설명이다.
//
//   기쁨  50°  · 슬픔 220° · 분노   0°
//   공포 270°  · 비꼼 200° · 중립  무채색
//
// `speed` 는 애니메이션 주기(초)다. 각성이 높은 감정일수록 짧게 잡았다.
export type ToneId = "joy" | "sadness" | "anger" | "fear" | "sarcasm" | "neutral";

export interface Tone {
  id: ToneId;
  label: string;
  color: string;
  speed: number;
}

export const TONES: Record<ToneId, Tone> = {
  joy: { id: "joy", label: "기쁨", color: "#E4C840", speed: 2.1 },
  sadness: { id: "sadness", label: "슬픔", color: "#375DA9", speed: 3.4 },
  anger: { id: "anger", label: "분노", color: "#C61515", speed: 1.9 },
  fear: { id: "fear", label: "공포", color: "#7019C8", speed: 2.0 },
  sarcasm: { id: "sarcasm", label: "비꼼", color: "#298EC0", speed: 2.6 },
  neutral: { id: "neutral", label: "감정 없음", color: "#8C8C8C", speed: 3.6 },
};

export const TONE_ORDER: ToneId[] = [
  "joy", "sadness", "anger", "fear", "sarcasm", "neutral",
];

// "#2F7A4D" → { h: 144, s: 44, l: 33 } — the emotion field takes HSL.
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// 백엔드 감정 → 범례의 여섯 가지.
//
// 모델이 내는 범주는 이보다 많고(놀람·체념·진심 등) 비꼼은 직접 예측하지 않는다.
// 그 간극을 메우는 곳이 여기 한 군데다.
//   · 비꼼 — 화난 목소리인데 (텍스트 보정 후) 정서가가 양수인 경우.
//            "괜찮아" 를 이 악물고 말하는 것.
//   · 놀람 — 매핑에서 기쁨과 같은 모양·거의 같은 색이라 기쁨으로 합친다.
//            화면에서 구분되지 않는 것을 범례에서만 나누면 거짓말이 된다.
//   · 체념·진심 — 각각 슬픔·기쁨 쪽으로 보낸다.
export function toneForEmotion(e: Emotion | undefined): ToneId {
  if (!e) return "neutral";
  const c = e.category as string;
  const v = e.valence ?? 0;
  const a = e.arousal ?? 0;
  if (c === "sarcasm") return "sarcasm";
  if (c === "anger" || c === "disgust") return v > 0.2 ? "sarcasm" : "anger";
  if (c === "fear") return "fear";
  if (c === "sadness" || c === "resignation") return "sadness";
  if (c === "joy" || c === "surprise" || c === "sincerity") return "joy";
  // neutral — V/A 위치로 떨어뜨린다.
  if (v < -0.1 && a > 0.35) return "anger";
  if (v < -0.1) return "sadness";
  if (v > 0.25 && a > 0.25) return "joy";
  return "neutral";
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
