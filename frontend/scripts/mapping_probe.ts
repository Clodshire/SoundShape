/**
 * Cross-language parity probe.
 *
 * Reads emotion/prosody cases as JSON on stdin, runs them through the SAME
 * TypeScript mapping the frontend uses, and prints one canonical line per
 * case. `backend/tests/test_mapping_parity.py` runs the identical cases
 * through the Python engine and compares the output byte for byte — which is
 * what actually proves the two implementations can't drift apart.
 *
 * Lives inside frontend/ so the `@/*` path alias resolves via its tsconfig.
 *
 *   echo '[{"emotion":{...}}]' | node_modules/.bin/tsx scripts/mapping_probe.ts
 */

import {
  mapEmotionToVisual,
  type ChannelWeights,
  type RenderMode,
} from "@/lib/mapping";
import type { Emotion, Prosody, VisualSpec } from "@/types/emotion";

interface Case {
  emotion: Emotion;
  prosody?: Prosody | null;
  // Present only for hybrid cases; absent means "let the config decide", which
  // is what the frontend itself does.
  reference?: Prosody | null;
  mode?: RenderMode;
  weights?: ChannelWeights | null;
}

/** Fixed-precision canonical form — identical rules on the Python side. */
function canonical(v: VisualSpec): string {
  const n = (x: number) => x.toFixed(6);
  return JSON.stringify({
    shape: v.shape,
    color: { h: n(v.color.h), s: n(v.color.s), l: n(v.color.l) },
    size: n(v.size),
    motion: {
      type: v.motion.type,
      amplitude: n(v.motion.amplitude),
      speed: n(v.motion.speed),
    },
  });
}

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const cases: Case[] = JSON.parse(raw);
  for (const c of cases) {
    process.stdout.write(
      canonical(
        mapEmotionToVisual(
          c.emotion,
          c.prosody,
          c.reference,
          c.mode,
          c.weights,
        ),
      ) + "\n",
    );
  }
});
