"use client";

import type { TimelineFrame } from "@/types/emotion";

// Captions now sit on the light stage, so they are dark type on paper rather
// than white type with a drop shadow. The word-level highlight has to be
// rebuilt for that: on black, "spoken already" was carried by opacity, which
// on a light ground would read as washed-out grey rather than as emphasis.
// Weight carries it here instead — the active word is the heavy one — with
// colour only supporting, so the line stays readable in greyscale.

interface Props {
  frame: TimelineFrame | null;
  currentTime: number;
}

export function SubtitleLayer({ frame, currentTime }: Props) {
  if (!frame) return null;

  const words = frame.words;

  return (
    <div className="max-w-2xl text-center">
      <p className="text-[30px] font-medium leading-snug tracking-tight text-ink">
        {/* An em dash opening the line is the subtitle convention for a change
            of speaker, so it needs no legend. */}
        {frame.speaker_changed && <span>{"— "}</span>}
        {words && words.length > 0 ? (
          words.map((w, i) => {
            const active = currentTime >= w.start && currentTime < w.end;
            const spoken = currentTime >= w.end;
            return (
              <span
                key={i}
                className={
                  active
                    ? "font-bold text-ink"
                    : spoken
                      ? "text-ink"
                      : "text-muted"
                }
              >
                {w.word}{" "}
              </span>
            );
          })
        ) : (
          <span>{frame.text}</span>
        )}
      </p>
    </div>
  );
}
