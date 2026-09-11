"use client";

import { useRef } from "react";
import { emotionName, useLocale, useT } from "@/lib/i18n";
import { mapEmotionToVisual } from "@/lib/mapping";
import type { TimelineFrame } from "@/types/emotion";

// Transport ruler.
//
// What made the old one read as a 1990s control panel was one decision: dark
// category text printed directly onto saturated fills, edge to edge, with no
// ruler and no quiet space. That is a Windows progress bar.
//
// Here the colour is kept — it is the mapping, and it has to stay visible —
// but demoted to a tinted lane with a solid rule on its leading edge, so the
// hue reads as an annotation rather than as a painted block. Type sits on the
// page, not on the colour. A tick ruler above gives the whole thing a scale,
// which is what turns "a coloured bar" into "a timeline".
//
// The lane is a real slider, not a div with pointer handlers. It used to be
// the latter, which meant the only way to seek was with a mouse — on a product
// about access, with the seek control missing from the tab order entirely.

interface Props {
  timeline: TimelineFrame[];
  totalDuration: number;
  currentTime: number;
  onSeek?: (t: number) => void;
}

const TICKS = 20;
const LABELLED = 5;

/** Arrow keys nudge; shift jumps. Matches what video players teach. */
const STEP = 1;
const BIG_STEP = 5;

export function EmotionTimeline({
  timeline,
  totalDuration,
  currentTime,
  onSeek,
}: Props) {
  const t = useT();
  const locale = useLocale();
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

  const nudge = (delta: number) => {
    if (!onSeek) return;
    onSeek(Math.min(dur, Math.max(0, currentTime + delta)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!onSeek) return;
    const step = e.shiftKey ? BIG_STEP : STEP;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        nudge(step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        nudge(-step);
        break;
      case "Home":
        e.preventDefault();
        onSeek(0);
        break;
      case "End":
        e.preventDefault();
        onSeek(dur);
        break;
      default:
    }
  };

  const here = [...timeline]
    .reverse()
    .find((f) => currentTime >= f.t && currentTime < f.t + f.duration);

  return (
    <div className="w-full select-none">
      {/* Ruler */}
      <div className="relative h-5">
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute bottom-0 w-px"
            style={{
              left: `${(i / TICKS) * 100}%`,
              height: i % (TICKS / LABELLED) === 0 ? 7 : 4,
              background: "var(--line-strong)",
            }}
          />
        ))}
        {Array.from({ length: LABELLED + 1 }, (_, i) => (
          <span
            key={i}
            className="tnum absolute top-0 text-[9px] text-faint"
            style={{
              left: `${(i / LABELLED) * 100}%`,
              transform:
                i === 0
                  ? "translateX(0)"
                  : i === LABELLED
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {fmt((i / LABELLED) * dur)}
          </span>
        ))}
      </div>

      {/* Lane */}
      <div
        ref={trackRef}
        role={onSeek ? "slider" : undefined}
        tabIndex={onSeek ? 0 : undefined}
        aria-label={onSeek ? t.timeline.seekLabel : undefined}
        aria-valuemin={onSeek ? 0 : undefined}
        aria-valuemax={onSeek ? Math.round(dur) : undefined}
        aria-valuenow={onSeek ? Math.round(currentTime) : undefined}
        // Time alone is not the useful readout here — a screen-reader user
        // seeking through this wants to know which reading they have landed on.
        aria-valuetext={
          onSeek
            ? `${t.timeline.at(fmt(currentTime))}${
                here ? ` · ${emotionName(here.emotion.category, locale)}` : ""
              }`
            : undefined
        }
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (!onSeek) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (onSeek && e.buttons === 1) seekFromClientX(e.clientX);
        }}
        className={[
          "relative mt-1 h-12 w-full overflow-hidden rounded",
          onSeek ? "cursor-pointer" : "",
        ].join(" ")}
        style={{ background: "var(--well)" }}
      >
        {/* Segments sit at their ACTUAL timestamps, so gaps are silence. */}
        {timeline.map((frame, i) => {
          const c = mapEmotionToVisual(frame.emotion).color;
          const left = (frame.t / dur) * 100;
          const width = Math.max(0.4, (frame.duration / dur) * 100);
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 flex flex-col justify-end overflow-hidden px-2 pb-1.5"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `hsl(${c.h} ${c.s}% ${c.l}% / 0.16)`,
                borderLeft: `2px solid hsl(${c.h} ${c.s}% ${c.l}%)`,
              }}
              title={`${emotionName(frame.emotion.category, locale)} · v=${frame.emotion.valence.toFixed(2)} a=${frame.emotion.arousal.toFixed(2)} · ${fmt(frame.t)}–${fmt(frame.t + frame.duration)}`}
            >
              {width > 6 && (
                <>
                  <span className="truncate text-[11px] font-medium text-ink">
                    {emotionName(frame.emotion.category, locale)}
                  </span>
                  <span className="tnum truncate text-[9px] text-faint">
                    {frame.duration.toFixed(1)}s
                  </span>
                </>
              )}
            </div>
          );
        })}

        {/* Playhead — the one place the accent is spent down here. */}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-[2px]"
          style={{ left: `${cursorPct}%`, background: "var(--accent)" }}
        />
        <div
          className="pointer-events-none absolute top-0 h-[7px] w-[7px] -translate-x-1/2 rotate-45"
          style={{
            left: `${cursorPct}%`,
            background: "var(--accent)",
            marginTop: -3,
          }}
        />
      </div>
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
