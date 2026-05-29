"use client";

import { EmotionCanvas } from "@/components/EmotionCanvas";
import { mapEmotionToVisual } from "@/lib/mapping";
import type { Emotion } from "@/types/emotion";

interface Item {
  emotion: Emotion;
  label: string;
  note: string;
}

const ITEMS: Item[] = [
  {
    emotion: { category: "anger", valence: -0.7, arousal: 0.8 },
    label: "Anger",
    note: "sharp · red · shaking",
  },
  {
    emotion: { category: "joy", valence: 0.7, arousal: 0.6 },
    label: "Joy",
    note: "blooming · yellow",
  },
  {
    emotion: { category: "sadness", valence: -0.6, arousal: -0.4 },
    label: "Sadness",
    note: "flowing · blue · slow",
  },
  {
    emotion: { category: "fear", valence: -0.5, arousal: 0.5 },
    label: "Fear",
    note: "trembling · violet",
  },
  {
    emotion: { category: "sincerity", valence: 0.3, arousal: -0.1 },
    label: "Sincerity",
    note: "soft · warm",
  },
  {
    emotion: { category: "neutral", valence: 0, arousal: 0 },
    label: "Neutral",
    note: "plain · grey",
  },
];

export function Legend() {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 text-xs text-white/40">
        Visual language — shape = emotion · color = feeling · size = intensity ·
        motion = stability
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ITEMS.map((it, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black">
              <EmotionCanvas
                visual={mapEmotionToVisual(it.emotion)}
                changedAt={i}
              />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-white">{it.label}</div>
              <div className="truncate text-xs text-white/50">{it.note}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
