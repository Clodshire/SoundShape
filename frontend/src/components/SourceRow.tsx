"use client";

import { useRef } from "react";

import { useT } from "@/lib/i18n";

// What is currently loaded, plus the way to change it.
//
// This replaces the permanent drop target that used to sit at the top of the
// page. A dropzone is onboarding: it earns the space once, on a first visit,
// and after that it is a large dashed rectangle asking a question the viewer
// has already answered. So the dropzone appears only until the first file is
// picked (see hasEverUploaded in page.tsx); from then on the input lives here,
// as one line naming what is playing and one button to replace it.

interface Props {
  label: string;
  detail?: string;
  /** Present while the backend is still working through the clip. */
  progressPct?: number | null;
  onFile: (file: File) => void;
  onBackToDemo?: () => void;
  disabled?: boolean;
}

export function SourceRow({
  label,
  detail,
  progressPct,
  onFile,
  onBackToDemo,
  disabled,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = progressPct != null && progressPct < 100;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {busy && (
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
              style={{ background: "var(--accent)" }}
              aria-hidden
            />
          )}
          <span className="truncate text-[12px]">{label}</span>
        </div>
        <div className="tnum truncate text-[11px] text-faint">
          {busy ? t.upload.analyzing(progressPct!.toFixed(0)) : detail}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onBackToDemo && (
          <button
            type="button"
            onClick={onBackToDemo}
            className="rounded-full px-3 py-1.5 text-[11px] text-muted transition hover:text-ink"
          >
            {t.upload.toDemo}
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-full border border-line px-3.5 py-1.5 text-[11px] text-muted transition hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t.upload.replace}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          // Cleared so picking the SAME file again still fires a change event.
          e.target.value = "";
        }}
      />
    </div>
  );
}
