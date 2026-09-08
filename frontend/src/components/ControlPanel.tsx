"use client";

import type { RenderMode } from "@/lib/mapping";

interface Props {
  showSoundShape: boolean;
  onToggleSoundShape: () => void;
  showCaptions: boolean;
  onToggleCaptions: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
  renderMode: RenderMode;
  onToggleRenderMode: () => void;
  // False when the current frame carries no measured prosody — hybrid has
  // nothing to read there and falls back, so the switch would do nothing.
  renderModeAvailable: boolean;
  showDetails: boolean;
  onToggleDetails: () => void;
}

export function ControlPanel({
  showSoundShape,
  onToggleSoundShape,
  showCaptions,
  onToggleCaptions,
  showLegend,
  onToggleLegend,
  renderMode,
  onToggleRenderMode,
  renderModeAvailable,
  showDetails,
  onToggleDetails,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle on={showSoundShape} onClick={onToggleSoundShape} label="SoundShape" />
      <Toggle on={showCaptions} onClick={onToggleCaptions} label="Captions" />
      <Toggle on={showLegend} onClick={onToggleLegend} label="Legend" />
      <Toggle on={showDetails} onClick={onToggleDetails} label="분석 정보" />
      <ModeSwitch
        mode={renderMode}
        onClick={onToggleRenderMode}
        available={renderModeAvailable}
      />
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

// Rendering mode is a comparison control, not a visibility control, so it reads
// as a labelled switch rather than another on/off pill. Flipping it recomputes
// the visual on the spot — the mapping is pure and the frontend already
// recomputes every frame, so no reprocessing is needed.
function ModeSwitch({
  mode,
  onClick,
  available,
}: {
  mode: RenderMode;
  onClick: () => void;
  available: boolean;
}) {
  const hybrid = mode === "hybrid" && available;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!available}
      title={
        !available
          ? "이 클립에는 측정된 운율이 없어 두 방식이 같습니다. 파일을 올리면 전환할 수 있습니다."
          : hybrid
            ? "크기·채도·움직임을 실제 목소리에서 측정합니다. 색과 모양만 AI 판단입니다."
            : "모든 채널을 AI의 감정 판단에서 만듭니다 (이전 방식)."
      }
      className="flex h-9 items-center gap-2 rounded-full border border-white/20 px-4 text-sm text-white/70 transition enabled:hover:bg-white/10 disabled:opacity-40"
    >
      <span className="text-white/40">렌더링</span>
      <span className={hybrid ? "font-medium text-emerald-400" : "text-white/50"}>
        하이브리드
      </span>
      <span className="text-white/25">/</span>
      <span className={hybrid ? "text-white/50" : "font-medium text-white"}>
        AI 전용
      </span>
    </button>
  );
}
