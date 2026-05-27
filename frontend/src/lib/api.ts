import type { Timeline } from "@/types/emotion";

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

export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
