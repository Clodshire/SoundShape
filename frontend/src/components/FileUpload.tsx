"use client";

import { useRef, useState } from "react";

import { useT } from "@/lib/i18n";

// First-run drop target only. Once a file has been picked the app remembers it
// (page.tsx → hasEverUploaded) and this is replaced by SourceRow's compact
// "다른 파일" button — a dropzone is onboarding, not permanent furniture.

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  hint?: string;
}

export function FileUpload({ onFile, disabled, hint }: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleFiles = (files: FileList | null) => {
    if (disabled) return;
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      // Stacked, not a row: this now lives in the narrow right rail, where a
      // single line of label + hint wrapped into an unreadable block.
      className={[
        "flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center text-[12px] transition",
        disabled
          ? "cursor-not-allowed border-line text-faint"
          : dragOver
            ? "cursor-pointer border-accent bg-accent-tint text-ink"
            : "cursor-pointer border-line-strong text-muted hover:border-ink hover:text-ink",
      ].join(" ")}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mb-0.5 h-5 w-5 shrink-0"
        aria-hidden
      >
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <span className="font-medium">{t.upload.cta}</span>
      <span className="text-[11px] leading-relaxed text-faint">
        {hint ?? t.upload.hint}
      </span>
      <span className="text-[10px] leading-relaxed text-faint">
        {t.upload.firstRun}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
