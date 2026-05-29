"use client";

import type { TimelineFrame } from "@/types/emotion";

interface Props {
  frame: TimelineFrame | null;
  currentTime: number;
}

export function SubtitleLayer({ frame, currentTime }: Props) {
  if (!frame) return null;

  const words = frame.words;

  return (
    <div className="max-w-2xl text-center">
      <p className="text-3xl font-medium leading-snug tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]">
        {words && words.length > 0 ? (
          words.map((w, i) => {
            const active = currentTime >= w.start && currentTime < w.end;
            const past = currentTime >= w.end;
            return (
              <span
                key={i}
                className={
                  active
                    ? "text-white"
                    : past
                      ? "text-white/80"
                      : "text-white/40"
                }
                style={
                  active
                    ? { textShadow: "0 0 14px rgba(255,255,255,0.55)" }
                    : undefined
                }
              >
                {w.word}{" "}
              </span>
            );
          })
        ) : (
          <span className="text-white">{frame.text}</span>
        )}
      </p>
    </div>
  );
}
