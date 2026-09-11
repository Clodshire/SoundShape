"use client";

import { Eyebrow } from "@/components/ui";
import { useT } from "@/lib/i18n";
import type { ChannelWeights } from "@/lib/mapping";

// Per-viewer calibration, given the weight it earns.
//
// This was a 10px underlined link at the bottom of the rail — measured 3.2:1
// against paper, below the body-text floor, on a product about access. It is
// also one of the few genuinely novel things here: a two-minute perceptual
// test that rescales the visual channels to the person watching.
//
// The card has two states, and the second is the point. Before the test it is
// an invitation. After it, it stops advertising and starts REPORTING — the
// four measured gains, on screen, applied. A link that says "personalise this"
// is a promise; four numbers that say what was measured about your eyes is a
// working system, and that is the version worth showing a judge.
//
// Laid out across the main column rather than down the rail: the feature is
// about how you see the STAGE, so it sits directly under the thing it tunes,
// and at full width the copy and the button can sit side by side instead of
// stacking into a tall block that pushed the readout off screen.

const CHANNELS: (keyof ChannelWeights)[] = [
  "saturation",
  "lightness",
  "size",
  "motion",
];

interface Props {
  weights: ChannelWeights | null;
  onStart: () => void;
  onReset: () => void;
}

export function CalibrationCard({ weights, onStart, onReset }: Props) {
  const t = useT();
  const applied = weights && CHANNELS.some((key) => weights[key] != null);

  return (
    <section
      // The accent rule is the poster's device for "this block matters",
      // spent here and nowhere else on the page.
      className="flex flex-col gap-4 pl-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8"
      style={{ borderLeft: "2px solid var(--accent)" }}
    >
      <div className="min-w-0">
        <Eyebrow className="mb-1.5">{t.calibration.eyebrow}</Eyebrow>

        {applied ? (
          <>
            <div className="flex items-center gap-2 text-[14px] font-medium text-ink">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--measured)" }}
                aria-hidden
              />
              {t.calibration.applied}
            </div>
            <p className="mt-1 max-w-lg text-[11px] leading-relaxed text-faint">
              {t.calibration.appliedNote}
            </p>
          </>
        ) : (
          <>
            <h2 className="text-[15px] font-medium text-ink">
              {t.calibration.title}
            </h2>
            <p className="mt-1 max-w-lg text-[12px] leading-relaxed text-muted">
              {t.calibration.note}
            </p>
          </>
        )}
      </div>

      {applied ? (
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <dl className="flex flex-wrap gap-x-5 gap-y-1">
            {CHANNELS.map((key) => {
              const v = weights?.[key];
              return (
                <div key={key} className="flex items-baseline gap-1.5">
                  <dt className="text-[11px] text-muted">
                    {t.calibration.channels[key]}
                  </dt>
                  <dd className="tnum text-[13px]">
                    {v == null ? "—" : `${v.toFixed(2)}×`}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onStart}
              className="rounded-full border border-line px-3.5 py-1.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink"
            >
              {t.calibration.again}
            </button>
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-faint underline decoration-line-strong underline-offset-4 transition hover:text-ink"
            >
              {t.calibration.reset}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStart}
          className="flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-ink px-5 py-2.5 text-[12px] font-medium text-white transition hover:opacity-90 sm:self-auto"
        >
          {t.calibration.start}
          <span className="tnum text-[11px] opacity-60">
            {t.calibration.duration}
          </span>
        </button>
      )}
    </section>
  );
}
