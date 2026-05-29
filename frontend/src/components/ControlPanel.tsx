"use client";

interface Props {
  showSoundShape: boolean;
  onToggleSoundShape: () => void;
  showCaptions: boolean;
  onToggleCaptions: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
}

export function ControlPanel({
  showSoundShape,
  onToggleSoundShape,
  showCaptions,
  onToggleCaptions,
  showLegend,
  onToggleLegend,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle on={showSoundShape} onClick={onToggleSoundShape} label="SoundShape" />
      <Toggle on={showCaptions} onClick={onToggleCaptions} label="Captions" />
      <Toggle on={showLegend} onClick={onToggleLegend} label="Legend" />
    </div>
  );
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={[
        "flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition",
        on
          ? "bg-white text-black"
          : "border border-white/20 text-white/70 hover:bg-white/10",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-2 w-2 rounded-full",
          on ? "bg-emerald-500" : "bg-white/30",
        ].join(" ")}
      />
      {label}
    </button>
  );
}
