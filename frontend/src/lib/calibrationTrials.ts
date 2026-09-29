// Building the calibration stimuli.
//
// Each trial isolates ONE channel: the channel under test varies with the
// emotion, and every other channel is pinned to a neutral value. Without that
// isolation a correct answer says nothing about which channel carried it.
//
// Two trial kinds, because a channel fails for two opposite reasons and they
// need opposite fixes (see backend/pipeline/calibration.py):
//   discrimination — "are these two the same?"  → is the difference visible
//   semantic       — "what does this mean?"      → does the difference signify
//
// Order and emotion choice are randomised per participant, so a lucky ordering
// cannot look like a channel effect.

import { mapEmotionToVisual, type ChannelWeights } from "@/lib/mapping";
import type { FieldVisual } from "@/lib/emotionField";
import type { Emotion } from "@/types/emotion";

export type Channel = "hue" | "shape" | "size" | "motion";
export type TrialKind = "discrimination" | "semantic";

export interface Trial {
  kind: TrialKind;
  channel: Channel;
  /** One stimulus for semantic-category trials, two for every other kind. */
  stimuli: FieldVisual[];
  /** What a correct answer is: an emotion name, "same"/"different", or "left"/"right". */
  expected: string;
  /** How to ask — decided by what the channel actually encodes. */
  question: "category" | "intensity" | "discrimination";
  options?: string[];
}

/**
 * Everything a channel is NOT allowed to leak through.
 *
 * 고정값은 감정을 하나도 가리키지 않아야 한다. 그런데 이전 값 `{h:0,s:0,l:55}`
 * 는 매핑 설정의 `color.neutral` 과 **똑같은 회색**이었다 — 이 시스템에서
 * 회색은 정보가 없는 색이 아니라 "중립"을 뜻하는 신호다. 그 결과 색상을 뺀
 * 나머지 세 채널의 문항 15개(20개 중)가 전부 중립처럼 보였고, 참가자가
 * 중립을 고르는 것이 합리적인 상황이 됐다. 고정값이 정답을 유도한 셈이다.
 *
 * 그래서 감정 팔레트에 배정되지 않은 색으로 바꾼다. 배정된 색상은
 * 0·45·50·80·200·220·230·270° 이고, 140°(초록)는 어느 쪽과도 60° 이상
 * 떨어져 있어 가장 넓은 빈 구간의 한가운데다. 채도는 "회색이 아님"이 보일
 * 정도로만 올린다.
 */
const NEUTRAL: FieldVisual = {
  shape: "simple_circle",
  color: { h: 140, s: 34, l: 55 },
  size: 0.5,
  motion: { type: "still", amplitude: 0, speed: 0 },
};

const VECTORS: Record<string, Emotion> = {
  joy: { category: "joy", valence: 0.7, arousal: 0.6 },
  sadness: { category: "sadness", valence: -0.6, arousal: -0.4 },
  anger: { category: "anger", valence: -0.7, arousal: 0.8 },
  fear: { category: "fear", valence: -0.5, arousal: 0.5 },
  sarcasm: { category: "sarcasm", valence: -0.35, arousal: 0.15 },
  neutral: { category: "neutral", valence: 0, arousal: 0 },
};

/**
 * A stimulus showing `emotion` through `channel` alone.
 *
 * The varying channel is taken from the real mapping rather than invented
 * here, so the test measures what the product actually renders. Intensity is
 * carried by size and motion, so those two are driven from the arousal level
 * instead of the category — asking "which emotion is this size?" would be a
 * question the channel was never built to answer.
 */
export function isolate(
  channel: Channel,
  emotion: string,
  intensity = 1,
): FieldVisual {
  const v = mapEmotionToVisual(VECTORS[emotion] ?? VECTORS.neutral);
  switch (channel) {
    case "hue":
      return { ...NEUTRAL, color: { h: v.color.h, s: 70, l: 55 } };
    case "shape":
      return { ...NEUTRAL, shape: v.shape };
    case "size":
      return { ...NEUTRAL, size: 0.35 + 0.6 * intensity };
    case "motion":
      // 위쪽 끝을 낮췄다. 진폭 0.85·속도 1.1 에서는 형태가 뭉개져서
      // "어느 쪽이 더 움직이나"가 아니라 "뭐가 보이긴 하나"를 묻는 문항이
      // 됐다. 아래 위 차이는 남겨 두어 변별은 그대로 가능하다.
      return {
        ...NEUTRAL,
        motion: {
          type: v.motion.type,
          amplitude: 0.15 + 0.45 * intensity,
          speed: 0.2 + 0.55 * intensity,
        },
      };
  }
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface BuildOptions {
  emotions: string[];
  discriminationPerChannel: number;
  semanticPerChannel: number;
  rand?: () => number;
}

export function buildTrials({
  emotions,
  discriminationPerChannel,
  semanticPerChannel,
  rand = Math.random,
}: BuildOptions): Trial[] {
  const channels: Channel[] = ["hue", "shape", "size", "motion"];
  const trials: Trial[] = [];
  // "neutral" is grey and still by construction, so it cannot appear as an
  // answer in an isolated trial — there would be nothing to see.
  const usable = emotions.filter((e) => e !== "neutral");

  for (const channel of channels) {
    const intensityChannel = channel === "size" || channel === "motion";

    for (let i = 0; i < discriminationPerChannel; i++) {
      // Half the trials are genuinely identical. Without those a participant
      // who always answers "different" would score 100%.
      const same = i % 2 === 0;
      if (intensityChannel) {
        const a = 0.25 + rand() * 0.2;
        const b = same ? a : a + 0.55;
        trials.push({
          kind: "discrimination",
          channel,
          stimuli: [isolate(channel, "joy", a), isolate(channel, "joy", b)],
          expected: same ? "same" : "different",
          question: "discrimination",
        });
      } else {
        const [x, y] = shuffle(usable, rand);
        trials.push({
          kind: "discrimination",
          channel,
          stimuli: [isolate(channel, x), isolate(channel, same ? x : y)],
          expected: same ? "same" : "different",
          question: "discrimination",
        });
      }
    }

    for (let i = 0; i < semanticPerChannel; i++) {
      if (intensityChannel) {
        // Size and motion encode HOW MUCH, not WHICH — so the question is a
        // forced choice between two levels, not an emotion name.
        const strongLeft = rand() < 0.5;
        const low = 0.15 + rand() * 0.15;
        const high = low + 0.55;
        trials.push({
          kind: "semantic",
          channel,
          stimuli: strongLeft
            ? [isolate(channel, "joy", high), isolate(channel, "joy", low)]
            : [isolate(channel, "joy", low), isolate(channel, "joy", high)],
          expected: strongLeft ? "left" : "right",
          question: "intensity",
        });
      } else {
        const target = shuffle(usable, rand)[0];
        trials.push({
          kind: "semantic",
          channel,
          stimuli: [isolate(channel, target)],
          expected: target,
          question: "category",
          options: shuffle(emotions, rand),
        });
      }
    }
  }
  return shuffle(trials, rand);
}

// ── crossover block ─────────────────────────────────────────────────
//
// Whether personalisation helps cannot be shown by "accuracy went up". That is
// exactly the evidence learning-styles research offered before the idea failed
// under proper testing (Pashler et al. 2008): what is required is a CROSSOVER
// interaction — the setting that suits a person should beat the one that does
// not, differently for people with different profiles.
//
// So the same emotions are shown twice, once with the default weights and once
// with the participant's own, randomly interleaved and never labelled. The
// participant cannot tell which is which, so expectation cannot drive it.

export interface CrossoverTrial {
  condition: "default" | "personal";
  stimulus: FieldVisual;
  expected: string;
  options: string[];
}

export function buildCrossover(
  emotions: string[],
  weights: ChannelWeights,
  pairs: number,
  rand: () => number = Math.random,
): CrossoverTrial[] {
  const usable = emotions.filter((e) => e !== "neutral");
  const trials: CrossoverTrial[] = [];
  for (let i = 0; i < pairs; i++) {
    const target = usable[i % usable.length];
    const emotion = VECTORS[target];
    // Full stimuli here, not isolated ones: the question is whether the whole
    // display reads better, which is what a viewer actually sees.
    trials.push({
      condition: "default",
      stimulus: mapEmotionToVisual(emotion),
      expected: target,
      options: shuffle(emotions, rand),
    });
    trials.push({
      condition: "personal",
      stimulus: mapEmotionToVisual(emotion, null, null, undefined, weights),
      expected: target,
      options: shuffle(emotions, rand),
    });
  }
  return shuffle(trials, rand);
}
