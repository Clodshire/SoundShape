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
        {/* An em dash opening the line is the subtitle convention for a change
            of speaker, so it needs no legend. Held at the same brightness as
            spoken text rather than following the word highlight — it belongs
            to the whole line, not to any word in it. */}
        {frame.speaker_changed && (
          <span className="text-white/85">{"\u2014 "}</span>
        )}
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
