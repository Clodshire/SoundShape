"use client";

import { LocaleSwitch } from "@/components/LocaleSwitch";
import { SegmentedPair, Switch } from "@/components/ui";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const hybrid = renderMode === "hybrid" && renderModeAvailable;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Switch label={t.controls.soundshape} on={showSoundShape} onChange={onToggleSoundShape} />
      <Switch label={t.controls.captions} on={showCaptions} onChange={onToggleCaptions} />
      <Switch label={t.controls.legend} on={showLegend} onChange={onToggleLegend} />
      <Switch label={t.controls.details} on={showDetails} onChange={onToggleDetails} />
      <SegmentedPair
        label={t.controls.rendering}
        options={[t.controls.hybrid, t.controls.aiOnly]}
        value={hybrid ? 0 : 1}
        onChange={onToggleRenderMode}
        disabled={!renderModeAvailable}
        title={
          !renderModeAvailable
            ? t.controls.unavailableHelp
            : hybrid
              ? t.controls.hybridHelp
              : t.controls.aiOnlyHelp
        }
      />
      {/* Language sits in the same row but is separated by a rule: it changes
          what the interface SAYS, while everything to its left changes what
          the stage SHOWS. */}
      <span
        aria-hidden
        className="hidden h-4 w-px shrink-0 sm:block"
        style={{ background: "var(--line)" }}
      />
      <LocaleSwitch />
    </div>
  );
}
