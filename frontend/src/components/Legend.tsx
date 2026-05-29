"use client";

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
    note: "violent · crimson · turbulent",
  },
  {
    emotion: { category: "joy", valence: 0.7, arousal: 0.6 },
    label: "Joy",
    note: "radiant · warm · blooming",
  },
  {
    emotion: { category: "sadness", valence: -0.6, arousal: -0.4 },
    label: "Sadness",
    note: "calm · blue · slow diffusion",
  },
  {
    emotion: { category: "fear", valence: -0.5, arousal: 0.5 },
    label: "Fear",
    note: "unstable · violet · trembling",
  },
  {
    emotion: { category: "sincerity", valence: 0.3, arousal: -0.1 },
    label: "Sincerity",
    note: "soft · warm · gentle",
  },
  {
    emotion: { category: "neutral", valence: 0, arousal: 0 },
    label: "Neutral",
    note: "still · grey · even",
  },
];

export function Legend() {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 text-xs text-white/40">
        Visual language — color = feeling · turbulence = arousal · flow = energy
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ITEMS.map((it, i) => {
          const c = mapEmotionToVisual(it.emotion).color;
          const bright = `hsl(${c.h} ${c.s}% ${Math.min(85, c.l + 28)}%)`;
          const mid = `hsl(${c.h} ${c.s}% ${c.l}%)`;
          const deep = `hsl(${(c.h + 32) % 360} ${c.s}% ${Math.max(20, c.l - 12)}%)`;
          return (
            <div key={i} className="flex items-center gap-3">
              <div
                className="h-12 w-12 shrink-0 rounded-full shadow-[0_0_18px_-2px_rgba(255,255,255,0.25)]"
                style={{
                  background: `radial-gradient(circle at 38% 32%, ${bright}, ${mid} 55%, ${deep} 100%)`,
                }}
              />
              <div className="min-w-0">
                <div className="text-sm text-white">{it.label}</div>
                <div className="truncate text-xs text-white/50">{it.note}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
