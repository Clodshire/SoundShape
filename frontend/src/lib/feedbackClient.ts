// Client side of the low-confidence feedback loop.
//
// Settings are fetched from the backend (`GET /feedback/config`) rather than
// duplicated here, so the prompt wording, pacing, and options have exactly one
// source of truth. This module owns three things the UI shouldn't:
//   * consent (persisted; nothing is sent before the viewer opts in)
//   * pacing  (interval + per-video cap + never ask about the same id twice)
//   * transport
//
// The feature vector never touches the browser — only the opaque id does.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

const CONSENT_KEY = "soundshape.feedback.consent";

export type Consent = "granted" | "declined" | "unset";

export interface FeedbackOption {
  value: string;
  label: string;
}

export interface FeedbackConfig {
  enabled: boolean;
  display_seconds: number;
  min_interval_seconds: number;
  max_prompts_per_video: number;
  question: string;
  options: FeedbackOption[];
  unsure_value: string;
  unsure_label: string;
}

export async function fetchFeedbackConfig(): Promise<FeedbackConfig | null> {
  try {
    const res = await fetch(`${API_BASE}/feedback/config`);
    if (!res.ok) return null;
    return (await res.json()) as FeedbackConfig;
  } catch {
    return null; // backend down → feature simply stays off
  }
}

export async function submitFeedback(
  feedbackId: string,
  label: string,
  responseMs: number,
): Promise<boolean> {
  try {
    const body = new FormData();
    body.append("feedback_id", feedbackId);
    body.append("label", label);
    body.append("response_ms", String(Math.round(responseMs)));
    const res = await fetch(`${API_BASE}/feedback`, { method: "POST", body });
    return res.ok;
  } catch {
    return false;
  }
}

// ── consent ──────────────────────────────────────────────────────────

export function getConsent(): Consent {
  if (typeof window === "undefined") return "unset";
  const v = window.localStorage.getItem(CONSENT_KEY);
  return v === "granted" || v === "declined" ? v : "unset";
}

export function setConsent(value: Exclude<Consent, "unset">): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, value);
}

// ── pacing ───────────────────────────────────────────────────────────

/**
 * Decides *whether* to surface a prompt. Kept separate from React so the rule
 * ("not too often, not twice for the same moment") is testable on its own.
 *
 * A prompt the viewer resents is worse than no data, so every rule here errs
 * toward staying quiet.
 */
export class PromptPacer {
  // -Infinity means "never shown", so the first prompt is never blocked by the
  // interval rule. Using 0 would work with Date.now() but silently gate the
  // first prompt under any clock that starts near zero.
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private shownThisVideo = 0;
  private seen = new Set<string>();

  constructor(
    private minIntervalSeconds: number,
    private maxPerVideo: number,
  ) {}

  /** Reset per-video counters when the source changes. */
  resetForNewVideo(): void {
    this.shownThisVideo = 0;
    this.seen.clear();
  }

  canShow(feedbackId: string, now: number = Date.now()): boolean {
    if (this.seen.has(feedbackId)) return false;
    if (this.shownThisVideo >= this.maxPerVideo) return false;
    if (now - this.lastShownAt < this.minIntervalSeconds * 1000) return false;
    return true;
  }

  markShown(feedbackId: string, now: number = Date.now()): void {
    this.seen.add(feedbackId);
    this.shownThisVideo += 1;
    this.lastShownAt = now;
  }
}
