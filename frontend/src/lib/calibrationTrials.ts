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

/** Everything a channel is NOT allowed to leak through. */
const NEUTRAL: FieldVisual = {
  shape: "simple_circle",
  color: { h: 0, s: 0, l: 55 },
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
      return { ...NEUTRAL, size: 0.25 + 0.6 * intensity };
    case "motion":
      return {
        ...NEUTRAL,
        motion: {
          type: v.motion.type,
          amplitude: 0.15 + 0.7 * intensity,
          speed: 0.2 + 0.9 * intensity,
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
