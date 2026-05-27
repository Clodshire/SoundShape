"use client";

import { useRef, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  hint?: string;
}

export function FileUpload({ onFile, disabled, hint }: Props) {
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
      tabIndex={0}
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
      className={[
        "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-8 px-6 transition",
        disabled
          ? "cursor-not-allowed border-white/10 bg-white/[0.02] text-white/30"
          : dragOver
            ? "cursor-pointer border-white/60 bg-white/10 text-white"
            : "cursor-pointer border-white/20 bg-white/[0.03] text-white/70 hover:border-white/40 hover:bg-white/[0.06]",
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
        className="h-7 w-7"
        aria-hidden
      >
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <p className="text-sm font-medium">
        Drop an audio or video file here, or click to pick
      </p>
      <p className="text-xs text-white/40">
        {hint ?? "WAV / MP3 / MP4 / MKV — first run loads models, ~30 s"}
      </p>
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
