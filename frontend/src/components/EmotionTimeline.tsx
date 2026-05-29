"use client";

import { useRef } from "react";
import { mapEmotionToVisual } from "@/lib/mapping";
import type { TimelineFrame } from "@/types/emotion";

interface Props {
  timeline: TimelineFrame[];
  totalDuration: number;
  currentTime: number;
  onSeek?: (t: number) => void;
}

export function EmotionTimeline({
  timeline,
  totalDuration,
  currentTime,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dur = Math.max(0.001, totalDuration);
  const cursorPct = Math.min(100, Math.max(0, (currentTime / dur) * 100));

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !onSeek) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * dur);
  };

  const TICKS = 4;
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (i / TICKS) * dur);

  return (
    <div className="w-full select-none">
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if (!onSeek) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (onSeek && e.buttons === 1) seekFromClientX(e.clientX);
        }}
        className={[
          "relative h-9 w-full overflow-hidden rounded-lg bg-white/[0.05]",
          onSeek ? "cursor-pointer" : "",
        ].join(" ")}
      >
        {/* Segments positioned by their ACTUAL timestamps (gaps = silence). */}
        {timeline.map((frame, i) => {
          const c = mapEmotionToVisual(frame.emotion).color;
          const left = (frame.t / dur) * 100;
          const width = Math.max(0.4, (frame.duration / dur) * 100);
          const bright = `hsl(${c.h} ${c.s}% ${Math.min(80, c.l + 18)}%)`;
          const deep = `hsl(${(c.h + 28) % 360} ${c.s}% ${Math.max(22, c.l - 10)}%)`;
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex items-center justify-center overflow-hidden"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `linear-gradient(180deg, ${bright}, ${deep})`,
              }}
              title={`${frame.emotion.category} · v=${frame.emotion.valence.toFixed(2)} a=${frame.emotion.arousal.toFixed(2)} · ${fmt(frame.t)}–${fmt(frame.t + frame.duration)}`}
            >
              {width > 7 && (
                <span className="truncate px-1 text-[10px] font-medium text-black/70">
                  {frame.emotion.category}
                </span>
              )}
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_white]"
          style={{ left: `${cursorPct}%` }}
        />
      </div>

      {/* Time axis */}
      <div className="relative mt-1 h-3 w-full text-[10px] text-white/35">
        {ticks.map((tk, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: `${(i / TICKS) * 100}%`,
              transform:
                i === 0
                  ? "translateX(0)"
                  : i === TICKS
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {fmt(tk)}
          </span>
        ))}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
