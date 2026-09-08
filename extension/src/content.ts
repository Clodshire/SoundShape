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
import { FeedbackController } from "./feedback";

const API_BASE = "http://localhost:8000";
const PREBUFFER_SEC = 4;
const PAUSE_MARGIN = 0.25;
const RESUME_MARGIN = 1.0;

interface Segment {
  t: number;
  duration: number;
  text: string;
  // True when this line is spoken by someone other than the previous one.
  // Rendered as a leading dash — the subtitle convention for a change of
  // speaker, matching the web app exactly.
  speaker_changed?: boolean;
  visual: FieldVisual;
  // Present only on segments the classifier was unsure about; opaque handle
  // for features held server-side (see backend/pipeline/feedback.py).
  emotion?: { feedback_id?: string; category_confidence?: number };
}

interface Session {
  videoId: string | null;
  stop: () => void;
}

let session: Session | null = null;

function getVideoId(): string | null {
  return new URLSearchParams(location.search).get("v");
}

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
    // The wave draws down the middle of its own canvas, so this band is
    // positioned to put that middle just above the caption line at 13% —
    // matching the web app. Centred on the frame it sat across the actors and
    // whatever they were holding, which is the part the viewer is watching.
    bottom: "15%",
    width: "100%",
    height: "36%",
    opacity: "0.95",
  } as CSSStyleDeclaration);

  const caption = document.createElement("div");
  Object.assign(caption.style, {
    position: "absolute",
    left: "0",
    right: "0",
    // Sit like a normal subtitle (~13% up), clear of YouTube's control bar and
    // the very bottom edge so long lines don't spill below the video.
    bottom: "13%",
    textAlign: "center",
    padding: "0 8%",
    color: "#fff",
    fontSize: "24px",
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
  let pausedByUs = false;
  const ctrl = new AbortController();

  // Asks the viewer about segments the classifier was unsure of. Config and
  // consent load in the background; until they arrive it simply stays silent,
  // so nothing here blocks playback starting.
  const feedbackCtl = new FeedbackController();
  void feedbackCtl.init();

  // The stop handle must exist BEFORE any await: navigations during the
  // (minutes-long) streaming phase need to tear this session down. Previously
  // `session` was only assigned after the stream finished, so a mid-analysis
  // navigation cleaned up nothing — video A's overlay kept running over B.
  session = {
    videoId: getVideoId(),
    stop: () => {
      if (stopped) return;
      stopped = true;
      ctrl.abort(); // cancels the NDJSON stream and the backend request
      cancelAnimationFrame(raf);
      field.destroy();
      overlay.remove();
      feedbackCtl.destroy(); // the prompt lives outside the overlay
      // Don't leave the player frozen if we were the ones who paused it.
      if (pausedByUs && video.paused) void video.play().catch(() => {});
    },
  };

  const setStatus = (s: string | null) => {
    if (s) {
      status.textContent = s;
      status.style.display = "";
    } else {
      status.style.display = "none";
    }
  };

  const maybeStart = () => {
    if (started || stopped) return;
    if (horizon >= PREBUFFER_SEC || done) {
      started = true;
      setStatus(null);
      video.currentTime = 0;
      pausedByUs = false;
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
      // Low confidence lowers the glyph's opacity rather than its colour: in
      // hybrid rendering saturation means measured arousal, so dimming it made
      // a calm voice and an unsure classifier indistinguishable.
      const conf = segs[idx].emotion?.category_confidence;
      field.setVisual({
        ...segs[idx].visual,
        uncertainty:
          conf == null ? 0 : Math.max(0, Math.min(1, 1 - conf / 0.85)),
      });
      caption.textContent = segs[idx].speaker_changed
        ? `\u2014 ${segs[idx].text}`
        : segs[idx].text;
      if (idx !== lastIdx) {
        field.pulse();
        lastIdx = idx;
        // Entering a new segment is the only moment worth asking about —
        // the controller drops it unless pacing and consent allow.
        feedbackCtl.maybeShow(segs[idx].emotion?.feedback_id, document.body);
      }
    }
    if (!done) {
      if (started && !video.paused && ct >= horizon - PAUSE_MARGIN) {
        video.pause();
        buffering = true;
        pausedByUs = true;
        setStatus("buffering…");
      } else if (buffering && horizon >= ct + RESUME_MARGIN) {
        buffering = false;
        pausedByUs = false;
        setStatus(null);
        void video.play().catch(() => {});
      }
    } else if (buffering) {
      buffering = false;
      pausedByUs = false;
      setStatus(null);
      void video.play().catch(() => {});
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  // Kick off the stream.
  video.pause();
  pausedByUs = true;
  try {
    const form = new FormData();
    form.append("url", location.href);
    const res = await fetch(`${API_BASE}/process/stream/url`, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
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
    if (ctrl.signal.aborted) return; // stopped mid-stream — expected, not an error
    setStatus(
      "SoundShape: backend not reachable — is uvicorn running on :8000?",
    );
    // eslint-disable-next-line no-console
    console.error("SoundShape error", err);
  }
}

// Inject the button now, and watch for video changes two ways: YouTube's SPA
// navigation event (primary) and a videoId poll (fallback — catches autoplay
// advances or a missed event). On an actual videoId change: tear down the old
// session and, if it was active, restart analysis on the new video through
// the same entry point as the button.
injectButton();
let currentVideoId = getVideoId();

function onVideoChange() {
  const vid = getVideoId();
  if (vid === currentVideoId) return;
  currentVideoId = vid;
  const wasActive = session !== null;
  if (session) {
    session.stop();
    session = null;
  }
  injectButton();
  const btn = document.getElementById(
    "soundshape-btn",
  ) as HTMLButtonElement | null;
  if (!btn) return;
  if (wasActive && vid) {
    btn.textContent = "✦ SoundShape — stop";
    void start(btn);
  } else {
    btn.textContent = "✦ SoundShape";
  }
}

document.addEventListener("yt-navigate-finish", onVideoChange);
setInterval(onVideoChange, 1000);
