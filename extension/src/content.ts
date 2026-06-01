// SoundShape Chrome extension — content script.
//
// Runs inside a YouTube watch page. On demand it:
//   1. sends the page URL to the local backend (/process/stream/url, yt-dlp)
//   2. reads the progressive NDJSON timeline
//   3. overlays the shared WebGL emotion field + a caption on the player
//   4. drives a short prebuffer + buffer-health gating, synced to the
//      player's own video.currentTime (one clock → no drift).
//
// Reuses frontend/src/lib/emotionField.ts so the visuals are identical to the
// web app. The backend pre-computes `segment.visual`, so this script needs no
// mapping logic — it just feeds the current segment's visual to the renderer.

import { createEmotionField, type FieldVisual } from "../../frontend/src/lib/emotionField";

const API_BASE = "http://localhost:8000";
const PREBUFFER_SEC = 4;
const PAUSE_MARGIN = 0.25;
const RESUME_MARGIN = 1.0;

interface Segment {
  t: number;
  duration: number;
  text: string;
  visual: FieldVisual;
}

interface Session {
  stop: () => void;
}

let session: Session | null = null;

function findVideo(): HTMLVideoElement | null {
  return (
    (document.querySelector("video.html5-main-video") as HTMLVideoElement) ||
    (document.querySelector("video") as HTMLVideoElement) ||
    null
  );
}

function findPlayer(): HTMLElement | null {
  return (
    (document.querySelector("#movie_player") as HTMLElement) ||
    (document.querySelector(".html5-video-player") as HTMLElement) ||
    findVideo()?.parentElement ||
    null
  );
}

// ── Floating control button on the page ──
function injectButton() {
  if (document.getElementById("soundshape-btn")) return;
  const btn = document.createElement("button");
  btn.id = "soundshape-btn";
  btn.textContent = "✦ SoundShape";
  Object.assign(btn.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "99999",
    padding: "10px 16px",
    borderRadius: "999px",
    border: "none",
    background: "linear-gradient(135deg,#7c3aed,#ec4899)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 4px 18px rgba(0,0,0,.45)",
    fontFamily: "system-ui, sans-serif",
  } as CSSStyleDeclaration);
  btn.addEventListener("click", () => {
    if (session) {
      session.stop();
      session = null;
      btn.textContent = "✦ SoundShape";
    } else {
      btn.textContent = "✦ SoundShape — stop";
      start(btn);
    }
  });
  document.body.appendChild(btn);
}

async function start(btn: HTMLButtonElement) {
  const video = findVideo();
  const player = findPlayer();
  if (!video || !player) {
    alert("SoundShape: couldn't find the YouTube video element.");
    btn.textContent = "✦ SoundShape";
    return;
  }

  if (getComputedStyle(player).position === "static") {
    player.style.position = "relative";
  }

  // Overlay: emotion field band (lower 40%) + caption, both non-interactive.
  const overlay = document.createElement("div");
  overlay.id = "soundshape-overlay";
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "30",
  } as CSSStyleDeclaration);

  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "absolute",
    left: "0",
    bottom: "70px",
    width: "100%",
    height: "40%",
    opacity: "0.95",
  } as CSSStyleDeclaration);

  const caption = document.createElement("div");
  Object.assign(caption.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "32px",
    textAlign: "center",
    padding: "0 8%",
    color: "#fff",
    fontSize: "26px",
    fontWeight: "600",
    textShadow: "0 2px 10px rgba(0,0,0,.95)",
    fontFamily: "system-ui, sans-serif",
  } as CSSStyleDeclaration);

  const status = document.createElement("div");
  Object.assign(status.style, {
    position: "absolute",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,.6)",
    color: "#fff",
    padding: "8px 16px",
    borderRadius: "999px",
    fontSize: "13px",
    fontFamily: "system-ui, sans-serif",
  } as CSSStyleDeclaration);
  status.textContent = "SoundShape: analyzing the opening…";

  overlay.appendChild(canvas);
  overlay.appendChild(caption);
  overlay.appendChild(status);
  player.appendChild(overlay);

  const field = createEmotionField(canvas, { transparent: true });

  const segs: Segment[] = [];
  let horizon = 0;
  let done = false;
  let started = false;
  let buffering = false;
  let lastIdx = -1;
  let stopped = false;
  let raf = 0;

  const setStatus = (s: string | null) => {
    if (s) {
      status.textContent = s;
      status.style.display = "";
    } else {
      status.style.display = "none";
    }
  };

  const maybeStart = () => {
    if (started) return;
    if (horizon >= PREBUFFER_SEC || done) {
      started = true;
      setStatus(null);
      video.currentTime = 0;
      void video.play().catch(() => {});
    }
  };

  // Render + sync loop.
  const loop = () => {
    if (stopped) return;
    const ct = video.currentTime;
    let idx = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (ct >= segs[i].t) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      field.setVisual(segs[idx].visual);
      caption.textContent = segs[idx].text;
      if (idx !== lastIdx) {
        field.pulse();
        lastIdx = idx;
      }
    }
    if (!done) {
      if (started && !video.paused && ct >= horizon - PAUSE_MARGIN) {
        video.pause();
        buffering = true;
        setStatus("buffering…");
      } else if (buffering && horizon >= ct + RESUME_MARGIN) {
        buffering = false;
        setStatus(null);
        void video.play().catch(() => {});
      }
    } else if (buffering) {
      buffering = false;
      setStatus(null);
      void video.play().catch(() => {});
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // Kick off the stream.
  video.pause();
  try {
    const form = new FormData();
    form.append("url", location.href);
    const res = await fetch(`${API_BASE}/process/stream/url`, {
      method: "POST",
      body: form,
    });
    if (!res.ok || !res.body) throw new Error(`backend ${res.status}`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const s = line.trim();
      if (!s) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(s);
      } catch {
        return;
      }
      if (ev.type === "status") setStatus("downloading audio…");
      else if (ev.type === "segment") {
        const seg = ev as unknown as Segment;
        segs.push(seg);
        horizon = Math.max(horizon, seg.t + seg.duration);
        maybeStart();
      } else if (ev.type === "done") {
        done = true;
        maybeStart();
      } else if (ev.type === "error") {
        setStatus("error: " + String(ev.message));
      }
    };
    for (;;) {
      if (stopped) break;
      const { done: d, value } = await reader.read();
      if (d) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
  } catch (err) {
    setStatus(
      "SoundShape: backend not reachable — is uvicorn running on :8000?",
    );
    // eslint-disable-next-line no-console
    console.error("SoundShape error", err);
  }

  session = {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      field.destroy();
      overlay.remove();
    },
  };
}

// Inject the button now and on YouTube's SPA navigations.
injectButton();
document.addEventListener("yt-navigate-finish", () => {
  if (session) {
    session.stop();
    session = null;
  }
  const btn = document.getElementById("soundshape-btn");
  if (btn) btn.textContent = "✦ SoundShape";
  injectButton();
});
