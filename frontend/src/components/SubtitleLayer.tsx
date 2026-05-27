"use client";

import type { TimelineFrame } from "@/types/emotion";

interface Props {
  frame: TimelineFrame | null;
}

export function SubtitleLayer({ frame }: Props) {
  if (!frame) return null;
  return (
    <div className="text-center">
      <p className="text-3xl font-medium tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
        {frame.text}
      </p>
    </div>
  );
}
