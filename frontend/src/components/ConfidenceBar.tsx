"use client";

import { useT } from "@/lib/i18n";

// How sure the classifier is.
//
// This number already drives the renderer — low confidence fades the field's
// opacity (emotionField.ts, u_unsure) — but it was never shown, so the one
// place the system admits doubt was invisible and the fade looked like a bug.
// Showing it turns "sometimes the glyph goes faint" into "the system reports
// what it does not know", which is the honest reading and the better answer
// when a judge asks how you handle a wrong classification.
//
// The bar is greyscale on purpose. Green and grey are spoken for — they mean
// measured versus inferred — and a red "low confidence" would read as an error
// when it is working exactly as designed.

const LOW = 0.62; // below this the renderer's fade is visible on screen

export function ConfidenceBar({ confidence }: { confidence: number }) {
  const t = useT();
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
  const low = confidence < LOW;

  return (
    <div className="border-b border-line py-[7px]">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[12px] text-muted" title={t.confidence.help}>
          {t.confidence.label}
        </dt>
        <dd className="tnum flex items-baseline gap-1.5 text-[20px] leading-none">
          {pct}%
          {low && (
            <span className="text-[10px] text-faint">{t.confidence.low}</span>
          )}
        </dd>
      </div>
      <div
        className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--well)" }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t.confidence.label}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${pct}%`,
            background: low ? "var(--line-strong)" : "var(--ink)",
          }}
        />
      </div>
    </div>
  );
}
