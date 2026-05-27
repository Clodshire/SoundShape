"use client";

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
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        onClick={onTogglePlay}
        className="flex h-10 items-center gap-2 rounded-full bg-white px-5 font-medium text-black transition hover:bg-zinc-200"
      >
        <span className="text-base leading-none">{isPlaying ? "⏸" : "▶"}</span>
        {isPlaying ? "Pause" : "Play"}
      </button>
      <button
        type="button"
        onClick={onRestart}
        className="flex h-10 items-center gap-2 rounded-full border border-white/30 px-5 font-medium text-white transition hover:bg-white/10"
      >
        <span>↻</span> Restart
      </button>
      <div className="ml-2 font-mono tabular-nums text-white/60">
        {formatTime(currentTime)} / {formatTime(totalDuration)}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
