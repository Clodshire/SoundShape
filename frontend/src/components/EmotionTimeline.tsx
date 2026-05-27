"use client";

import { mapEmotionToVisual } from "@/lib/mapping";
import type { TimelineFrame } from "@/types/emotion";

interface Props {
  timeline: TimelineFrame[];
  totalDuration: number;
  currentTime: number;
}

export function EmotionTimeline({
  timeline,
  totalDuration,
  currentTime,
}: Props) {
  const cursorPct = Math.min(100, (currentTime / totalDuration) * 100);

  return (
    <div className="relative w-full">
      <div className="flex h-7 w-full overflow-hidden rounded-full">
        {timeline.map((frame, i) => {
          const v = mapEmotionToVisual(frame.emotion);
          const width = (frame.duration / totalDuration) * 100;
          return (
            <div
              key={i}
              className="flex items-center justify-center text-[10px] font-medium text-white/90"
              style={{
                width: `${width}%`,
                background: `hsl(${v.color.h} ${v.color.s}% ${v.color.l}%)`,
              }}
              title={`${frame.emotion.category} · v=${frame.emotion.valence.toFixed(2)} a=${frame.emotion.arousal.toFixed(2)}`}
            >
              {frame.emotion.category}
            </div>
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute -top-1 h-9 w-0.5 bg-white shadow-[0_0_8px_white]"
        style={{ left: `${cursorPct}%` }}
      />
    </div>
  );
}
