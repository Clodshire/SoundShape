// Low-confidence feedback prompt for the YouTube overlay.
//
// Mirrors the web app's behaviour (frontend/src/lib/feedbackClient.ts +
// components/FeedbackPrompt.tsx) but written as plain DOM, since a content
// script has no React. The two share what matters — the same backend config
// endpoint, so wording, pacing, and options are never duplicated in code.
//
// Extension-specific concerns handled here:
//   * consent lives in chrome.storage.local, not localStorage (page storage is
//     per-origin and would be lost/duplicated across sites)
//   * the card must be torn down on YouTube's SPA navigation, alongside the
//     rest of the overlay

const API_BASE = "http://localhost:8000";

// Minimal declaration of the only extension API this file touches. Narrower
// than pulling in @types/chrome for two calls, and it documents the surface.
declare const chrome: {
  storage?: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

interface FeedbackOption {
  value: string;
  label: string;
}

interface FeedbackConfig {
  enabled: boolean;
  display_seconds: number;
  min_interval_seconds: number;
  max_prompts_per_video: number;
  question: string;
  options: FeedbackOption[];
  unsure_value: string;
  unsure_label: string;
}

const CONSENT_KEY = "soundshape_feedback_consent";

async function getConsent(): Promise<"granted" | "declined" | "unset"> {
  try {
    const got = await chrome.storage?.local.get(CONSENT_KEY);
    const v = got?.[CONSENT_KEY];
    return v === "granted" || v === "declined" ? v : "unset";
  } catch {
    return "unset";
  }
}

async function setConsent(v: "granted" | "declined"): Promise<void> {
  try {
    await chrome.storage?.local.set({ [CONSENT_KEY]: v });
  } catch {
    /* storage unavailable — treat as ephemeral */
  }
}

async function fetchConfig(): Promise<FeedbackConfig | null> {
  try {
    const res = await fetch(`${API_BASE}/feedback/config`);
    if (!res.ok) return null;
    const cfg = (await res.json()) as FeedbackConfig;
    return cfg.enabled ? cfg : null;
  } catch {
    return null; // backend down → feature simply stays off
  }
}

async function submit(id: string, label: string, ms: number): Promise<void> {
  try {
    const body = new FormData();
    body.append("feedback_id", id);
    body.append("label", label);
    body.append("response_ms", String(Math.round(ms)));
    await fetch(`${API_BASE}/feedback`, { method: "POST", body });
  } catch {
    /* the viewer already saw a thank-you; a failed post is not their problem */
  }
}

/**
 * Owns prompting for one playback session: pacing, the card, and teardown.
 *
 * Pacing mirrors the web app — never twice for the same moment, never more
 * than the per-video cap, never closer together than the configured interval.
 */
export class FeedbackController {
  private config: FeedbackConfig | null = null;
  private consent: "granted" | "declined" | "unset" = "unset";
  private card: HTMLElement | null = null;
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private shownThisVideo = 0;
  private seen = new Set<string>();
  private destroyed = false;

  /** Load config + consent. Safe to call before the stream starts. */
  async init(): Promise<void> {
    const [cfg, consent] = await Promise.all([fetchConfig(), getConsent()]);
    if (this.destroyed) return;
    this.config = cfg;
    this.consent = consent;
  }

  resetForNewVideo(): void {
    this.shownThisVideo = 0;
    this.seen.clear();
    this.dismiss();
  }

  /** Called when playback enters a segment; no-ops unless a prompt is due. */
  maybeShow(feedbackId: string | undefined, host: HTMLElement): void {
    if (!feedbackId || !this.config || this.destroyed) return;
    if (this.consent === "declined" || this.card) return;
    if (this.seen.has(feedbackId)) return;
    if (this.shownThisVideo >= this.config.max_prompts_per_video) return;
    const now = Date.now();
    if (now - this.lastShownAt < this.config.min_interval_seconds * 1000) return;

    this.seen.add(feedbackId);
    this.shownThisVideo += 1;
    this.lastShownAt = now;
    this.card =
      this.consent === "unset"
        ? this.buildConsent(host)
        : this.buildQuestion(host, feedbackId);
  }

  dismiss(): void {
    this.card?.remove();
    this.card = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.dismiss();
  }

  // ── DOM ────────────────────────────────────────────────────────────

  private shell(host: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "76px", // clears the ✦ SoundShape button
      width: "300px",
      zIndex: "100000",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,.15)",
      background: "rgba(24,24,27,.97)",
      color: "#fff",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 8px 32px rgba(0,0,0,.5)",
      overflow: "hidden",
    } as CSSStyleDeclaration);
    el.className = "soundshape-fb";
    host.appendChild(el);
    return el;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = label;
    Object.assign(b.style, {
      padding: "7px 4px",
      borderRadius: "8px",
      border: "1px solid rgba(255,255,255,.15)",
      background: "transparent",
      color: "rgba(255,255,255,.9)",
      fontSize: "12px",
      cursor: "pointer",
      fontFamily: "inherit",
    } as CSSStyleDeclaration);
    b.addEventListener("mouseenter", () => {
      b.style.background = "rgba(255,255,255,.1)";
    });
    b.addEventListener("mouseleave", () => {
      b.style.background = "transparent";
    });
    b.addEventListener("click", onClick);
    return b;
  }

  private buildConsent(host: HTMLElement): HTMLElement {
    const el = this.shell(host);
    const pad = document.createElement("div");
    pad.style.padding = "14px";

    const title = document.createElement("div");
    title.textContent = "감정 인식을 함께 개선할까요?";
    Object.assign(title.style, { fontSize: "13px", fontWeight: "600" });

    const body = document.createElement("div");
    body.innerHTML =
      "AI가 헷갈린 구간에서 가끔 짧게 여쭤봅니다. 답변은 정확도 개선에만 쓰이며, " +
      "<strong>음성은 저장하지 않고</strong> 분석된 숫자만 저장합니다.";
    Object.assign(body.style, {
      fontSize: "11.5px",
      lineHeight: "1.6",
      color: "rgba(255,255,255,.7)",
      marginTop: "8px",
    } as CSSStyleDeclaration);

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "8px", marginTop: "12px" });

    const yes = this.button("참여하기", () => {
      void setConsent("granted");
      this.consent = "granted";
      this.dismiss(); // ask at the next uncertain moment, not mid-decision
    });
    Object.assign(yes.style, {
      flex: "1",
      background: "#fff",
      color: "#000",
      border: "none",
      fontWeight: "500",
    } as CSSStyleDeclaration);
    yes.addEventListener("mouseenter", () => (yes.style.background = "#eee"));
    yes.addEventListener("mouseleave", () => (yes.style.background = "#fff"));

    const no = this.button("사양할게요", () => {
      void setConsent("declined");
      this.consent = "declined";
      this.dismiss();
    });

    row.append(yes, no);
    pad.append(title, body, row);
    el.appendChild(pad);
    return el;
  }

  private buildQuestion(host: HTMLElement, feedbackId: string): HTMLElement {
    const cfg = this.config!;
    const el = this.shell(host);
    const shownAt = Date.now();

    const pad = document.createElement("div");
    pad.style.padding = "14px 14px 12px";

    const head = document.createElement("div");
    Object.assign(head.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: "8px",
    } as CSSStyleDeclaration);

    const q = document.createElement("div");
    q.textContent = cfg.question;
    Object.assign(q.style, { fontSize: "13px", fontWeight: "600" });

    const close = this.button("×", () => this.dismiss());
    Object.assign(close.style, {
      border: "none",
      padding: "0 6px",
      fontSize: "16px",
      color: "rgba(255,255,255,.4)",
    } as CSSStyleDeclaration);

    head.append(q, close);

    const grid = document.createElement("div");
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "6px",
      marginTop: "12px",
    } as CSSStyleDeclaration);

    const answer = (value: string) => {
      void submit(feedbackId, value, Date.now() - shownAt);
      pad.innerHTML = "";
      const thanks = document.createElement("div");
      thanks.textContent = "고맙습니다 — 정확도 개선에 반영할게요.";
      Object.assign(thanks.style, {
        fontSize: "12.5px",
        color: "rgba(255,255,255,.8)",
        textAlign: "center",
        padding: "10px 0",
      } as CSSStyleDeclaration);
      pad.appendChild(thanks);
      window.setTimeout(() => this.dismiss(), 900);
    };

    for (const o of cfg.options) {
      grid.appendChild(this.button(o.label, () => answer(o.value)));
    }

    const unsure = this.button(cfg.unsure_label, () =>
      answer(cfg.unsure_value),
    );
    Object.assign(unsure.style, {
      border: "none",
      width: "100%",
      marginTop: "8px",
      color: "rgba(255,255,255,.5)",
    } as CSSStyleDeclaration);

    pad.append(head, grid, unsure);
    el.appendChild(pad);

    // Countdown bar. The same CSS animation both draws the bar and triggers
    // dismissal on `animationend`, so pausing it on hover pauses the deadline
    // too — the visible countdown can never disagree with the real one.
    const track = document.createElement("div");
    Object.assign(track.style, {
      height: "3px",
      width: "100%",
      background: "rgba(255,255,255,.1)",
    } as CSSStyleDeclaration);
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      height: "100%",
      width: "100%",
      background: "rgba(255,255,255,.5)",
      animation: `soundshape-fb-drain ${cfg.display_seconds}s linear forwards`,
    } as CSSStyleDeclaration);
    bar.addEventListener("animationend", () => this.dismiss());
    el.addEventListener("mouseenter", () => {
      bar.style.animationPlayState = "paused";
    });
    el.addEventListener("mouseleave", () => {
      bar.style.animationPlayState = "running";
    });
    track.appendChild(bar);
    el.appendChild(track);

    ensureKeyframes();
    return el;
  }
}

let keyframesAdded = false;
function ensureKeyframes(): void {
  if (keyframesAdded || document.getElementById("soundshape-fb-style")) return;
  const style = document.createElement("style");
  style.id = "soundshape-fb-style";
  style.textContent =
    "@keyframes soundshape-fb-drain { from { width: 100%; } to { width: 0%; } }";
  document.head.appendChild(style);
  keyframesAdded = true;
}
