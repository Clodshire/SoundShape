import type { Timeline, TimelineFrame } from "@/types/emotion";

// Backend base URL. Override via NEXT_PUBLIC_API_BASE if uvicorn runs elsewhere.
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface ProcessOptions {
  language?: string; // ISO-639-1 hint for Whisper, e.g. "ko"
  modelSize?: string; // "base" | "large-v3-turbo"
}

export async function processFile(
  file: File,
  opts: ProcessOptions = {},
): Promise<Timeline> {
  const form = new FormData();
  form.append("file", file);
  if (opts.language) form.append("language", opts.language);
  if (opts.modelSize) form.append("model_size", opts.modelSize);

  const res = await fetch(`${API_BASE}/process`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }

  // Backend emits "category_confidence" but the frontend's Emotion type
  // uses "confidence" — translate at the boundary so renderer code stays clean.
  const raw = (await res.json()) as Timeline;
  for (const seg of raw.segments) {
    const e = seg.emotion as unknown as Record<string, unknown>;
    if (e.category_confidence != null && e.confidence == null) {
      e.confidence = e.category_confidence;
    }
  }
  return raw;
}

// ── Progressive streaming consumer ──────────────────────────────────────
// Reads the NDJSON stream from POST /process/stream and fires callbacks as
// each event arrives, so the UI can start playback after a short prebuffer.

export interface StreamCallbacks {
  onMetadata?: (meta: Timeline["metadata"]) => void;
  onLanguage?: (language: string) => void;
  onSegment?: (segment: TimelineFrame) => void;
  onDone?: (count: number) => void;
  onError?: (message: string) => void;
}

export async function processFileStream(
  file: File,
  callbacks: StreamCallbacks,
  opts: ProcessOptions = {},
): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  if (opts.language) form.append("language", opts.language);
  if (opts.modelSize) form.append("model_size", opts.modelSize);

  const res = await fetch(`${API_BASE}/process/stream`, {
    method: "POST",
    body: form,
  });
  if (!res.ok || !res.body) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      return; // ignore partial/garbage line
    }
    switch (ev.type) {
      case "metadata":
        callbacks.onMetadata?.(ev as unknown as Timeline["metadata"]);
        break;
      case "language":
        callbacks.onLanguage?.(String(ev.language ?? ""));
        break;
      case "segment": {
        const seg = ev as unknown as TimelineFrame;
        // Boundary translation: category_confidence → confidence.
        const e = seg.emotion as unknown as Record<string, unknown>;
        if (e.category_confidence != null && e.confidence == null) {
          e.confidence = e.category_confidence;
        }
        callbacks.onSegment?.(seg);
        break;
      }
      case "done":
        callbacks.onDone?.(Number(ev.segments ?? 0));
        break;
      case "error":
        callbacks.onError?.(String(ev.message ?? "unknown error"));
        break;
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer.trim()) handleLine(buffer);
}

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
