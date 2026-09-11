"use client";

import { emotionName, useLocale, useT } from "@/lib/i18n";
import { mapEmotionToVisual } from "@/lib/mapping";
import { CHIP_GLYPH, waveGlyphPath } from "@/lib/waveGlyph";
import type { Emotion, EmotionCategory } from "@/types/emotion";

// The legend's job is to teach the visual language, so it has to show the
// language the renderer actually speaks. It used to show six glossy spheres in
// six hues, which taught colour and quietly implied that shape did nothing —
// the opposite of the claim the project is built on. Each row draws the real
// waveform silhouette for that emotion, generated from the renderer's own
// constants (waveGlyph.ts), so what a viewer learns here is what they will see
// on the stage.

type LegendKey = "anger" | "joy" | "sadness" | "fear" | "sincerity" | "neutral";

const ITEMS: { key: LegendKey; emotion: Emotion }[] = [
  { key: "anger", emotion: { category: "anger", valence: -0.7, arousal: 0.8 } },
  { key: "joy", emotion: { category: "joy", valence: 0.7, arousal: 0.6 } },
  { key: "sadness", emotion: { category: "sadness", valence: -0.6, arousal: -0.4 } },
  { key: "fear", emotion: { category: "fear", valence: -0.5, arousal: 0.5 } },
  { key: "sincerity", emotion: { category: "sincerity", valence: 0.3, arousal: -0.1 } },
  { key: "neutral", emotion: { category: "neutral", valence: 0, arousal: 0 } },
];

const GLYPH_W = 74;
const GLYPH_H = 20;

export function Legend() {
  const t = useT();
  const locale = useLocale();

  return (
    <div className="space-y-3">
      {ITEMS.map(({ key, emotion }) => {
        const visual = mapEmotionToVisual(emotion);
        const c = visual.color;
        return (
          <div key={key} className="flex items-center gap-3.5">
            <svg
              viewBox={`0 0 ${GLYPH_W} ${GLYPH_H}`}
              width={GLYPH_W}
              height={GLYPH_H}
              className="shrink-0"
              aria-hidden
            >
              <path
                d={waveGlyphPath(visual, GLYPH_W, GLYPH_H, CHIP_GLYPH)}
                fill={`hsl(${c.h} ${c.s}% ${c.l}%)`}
              />
            </svg>
            <div className="min-w-0">
              <div className="text-[12px]">
                {emotionName(emotion.category as EmotionCategory, locale)}
              </div>
              <div className="text-[11px] leading-snug text-faint">
                {t.legendReads[key]}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
