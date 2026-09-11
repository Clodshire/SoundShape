"use client";

import { useT } from "@/lib/i18n";

// Small shared primitives. Kept together because they are the vocabulary the
// rest of the interface is written in — a label, a switch, a source badge —
// and they only mean anything if they stay identical everywhere.

/** The poster's eyebrow: small mono caps, wide tracking, quiet. */
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

/**
 * Where a number came from.
 *
 * The green/grey pair is reserved for exactly this distinction — measured off
 * the voice versus inferred by the classifier — because that split is the
 * project's actual claim. A dot rather than a filled pill: at eight rows a
 * column of pills competes with the numbers they are annotating.
 */
export function SourceDot({ source }: { source: "measured" | "inferred" }) {
  const t = useT();
  const measured = source === "measured";
  return (
    <span
      aria-label={measured ? t.readout.measured : t.readout.inferred}
      title={measured ? t.readout.measuredHelp : t.readout.inferredHelp}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: measured ? "var(--measured)" : "var(--line-strong)" }}
    />
  );
}

export function SourceKey() {
  const t = useT();
  return (
    <div className="flex items-center gap-4 text-[10px] text-faint">
      <span className="flex items-center gap-1.5">
        <SourceDot source="measured" />
        {t.readout.measured}
      </span>
      <span className="flex items-center gap-1.5">
        <SourceDot source="inferred" />
        {t.readout.inferred}
      </span>
    </div>
  );
}

/**
 * A real toggle switch.
 *
 * The pills this replaces changed only their fill colour when clicked, which
 * reads as "a button that happens to be highlighted" rather than as a thing
 * with an on and an off position — and it put the entire state on colour, so
 * it vanished in greyscale and for anyone who cannot separate the two hues.
 * A switch carries state in the knob's POSITION; colour only reinforces it.
 */
export function Switch({
  label,
  on,
  onChange,
  disabled,
  title,
}: {
  label: React.ReactNode;
  on: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onChange}
      className={[
        "group flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] transition",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
        on ? "text-ink" : "text-muted hover:text-ink",
      ].join(" ")}
    >
      <span
        aria-hidden
        className="relative inline-block h-[18px] w-[32px] shrink-0 rounded-full border transition-colors"
        style={{
          background: on ? "var(--accent)" : "transparent",
          borderColor: on ? "var(--accent)" : "var(--line-strong)",
        }}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all"
          style={{
            left: on ? 17 : 2,
            background: on ? "#fff" : "var(--line-strong)",
          }}
        />
      </span>
      {label}
    </button>
  );
}

/**
 * Two mutually exclusive modes, shown side by side.
 *
 * Not a Switch: hybrid and full-AI are not on and off, they are two ways of
 * rendering the same clip, and the control exists so the two can be compared.
 * A switch would imply one of them is the absence of the other.
 */
export function SegmentedPair({
  label,
  options,
  value,
  onChange,
  disabled,
  title,
}: {
  label: string;
  options: [string, string];
  value: 0 | 1;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      <span className="eyebrow">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex rounded-full border p-[2px]"
        style={{ borderColor: "var(--line)", opacity: disabled ? 0.45 : 1 }}
      >
        {options.map((opt, i) => {
          const active = value === i;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              title={title}
              onClick={() => {
                if (!active) onChange();
              }}
              className={[
                "rounded-full px-2.5 py-[3px] text-[11px] transition",
                active ? "font-medium text-white" : "text-muted hover:text-ink",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
              style={active ? { background: "var(--ink)" } : undefined}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Visually hidden, still announced. */
export function SrOnly({
  children,
  live,
}: {
  children: React.ReactNode;
  live?: "polite" | "assertive";
}) {
  return (
    <span
      aria-live={live}
      className="absolute h-px w-px overflow-hidden whitespace-nowrap"
      style={{ clip: "rect(0 0 0 0)", clipPath: "inset(50%)" }}
    >
      {children}
    </span>
  );
}
