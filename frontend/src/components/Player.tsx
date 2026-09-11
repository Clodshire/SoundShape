"use client";

import { useT } from "@/lib/i18n";

interface Props {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  onTogglePlay: () => void;
  onRestart: () => void;
}

export function Player({
  isPlaying,
  currentTime,
  totalDuration,
  onTogglePlay,
  onRestart,
}: Props) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={isPlaying ? t.player.pause : t.player.play}
        className="flex h-10 items-center gap-2.5 rounded-full bg-ink px-5 text-[13px] font-medium text-white transition hover:opacity-90"
      >
        {/* Drawn, not typed. ▶ and ⏸ are emoji-presentation on some platforms
            and glyph-presentation on others, so the button used to change size
            and baseline between one laptop and the next. */}
        <PlayPause playing={isPlaying} />
        {isPlaying ? t.player.pause : t.player.play}
      </button>
      <button
        type="button"
        onClick={onRestart}
        aria-label={t.player.restart}
        className="flex h-10 items-center gap-2 rounded-full border border-line px-4 text-[13px] text-muted transition hover:border-line-strong hover:text-ink"
      >
        <Restart />
        {t.player.restart}
      </button>
      <div className="tnum text-[13px]">
        {fmt(currentTime)}
        <span className="text-faint"> / {fmt(totalDuration)}</span>
      </div>
    </div>
  );
}

function PlayPause({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden>
      {playing ? (
        <>
          <rect x="2" y="1.5" width="3" height="9" rx="0.6" />
          <rect x="7" y="1.5" width="3" height="9" rx="0.6" />
        </>
      ) : (
        <path d="M2.5 1.6 10.2 6 2.5 10.4Z" />
      )}
    </svg>
  );
}

function Restart() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 6a4 4 0 1 1-1.3-2.95" />
      <path d="M10.2 1.4v2.6H7.6" />
    </svg>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
