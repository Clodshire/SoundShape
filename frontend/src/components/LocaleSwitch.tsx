"use client";

import { useEffect, useRef, useState } from "react";
import { type Locale, setLocale, useLocale, useT } from "@/lib/i18n";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
];

/**
 * Globe, sitting in the control row, opening a short menu.
 *
 * Icon-only so it weighs the same as the switches beside it — a labelled
 * button in that row read as a fifth control of the same kind, when it is
 * really a different sort of thing. The menu names each language IN that
 * language, which is the one form a visitor can act on without already being
 * able to read the page.
 */
export function LocaleSwitch() {
  const locale = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // A menu that stays open after you click past it is the classic dropdown
  // bug; Escape returns focus to the button so keyboard users are not stranded.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.langSwitch}
        title={t.langSwitch}
        className={[
          "flex h-[26px] w-[26px] items-center justify-center rounded-full border transition",
          open
            ? "border-line-strong text-ink"
            : "border-line text-muted hover:border-line-strong hover:text-ink",
        ].join(" ")}
      >
        <GlobeIcon />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t.langSwitch}
          className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[124px] overflow-hidden rounded-lg border border-line py-1 shadow-lg"
          style={{ background: "var(--raised)" }}
        >
          {OPTIONS.map((opt) => {
            const active = opt.value === locale;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                lang={opt.value}
                onClick={() => {
                  setLocale(opt.value);
                  setOpen(false);
                }}
                className={[
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition",
                  active ? "text-ink" : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {/* The tick reserves its space whether or not it is drawn, so
                    the two labels stay on one left edge. */}
                <span className="w-3 shrink-0" aria-hidden>
                  {active ? <CheckIcon /> : null}
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4" />
      {/* The meridian is what stops a circle with a line through it from
          reading as a "no entry" sign at 14px. */}
      <path d="M8 1.8c1.9 2 2.9 4 2.9 6.2s-1 4.2-2.9 6.2c-1.9-2-2.9-4-2.9-6.2s1-4.2 2.9-6.2Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 6.2 4.6 8.8 10 3.4" />
    </svg>
  );
}
