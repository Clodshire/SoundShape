"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "@/components/ControlPanel";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { EmotionTimeline } from "@/components/EmotionTimeline";
import { FileUpload } from "@/components/FileUpload";
import { CalibrationTest } from "@/components/CalibrationTest";
import { Legend } from "@/components/Legend";
import { Player } from "@/components/Player";
import { SubtitleLayer } from "@/components/SubtitleLayer";
import { processFileStream } from "@/lib/api";
import { loadWeights } from "@/lib/calibrationStore";
import {
  DEFAULT_RENDER_MODE,
  mapEmotionToVisual,
  type ChannelWeights,
  type RenderMode,
} from "@/lib/mapping";
import {
  DEMO_TIMELINE,
  DEMO_TIMELINE_DURATION,
  getCurrentFrame,
} from "@/lib/timeline";
import type { TimelineFrame } from "@/types/emotion";
import { buildTimelineFromScript } from "@/lib/scriptMode";
import { FeedbackPrompt } from "@/components/FeedbackPrompt";
import {
  type FeedbackConfig,
  PromptPacer,
  fetchFeedbackConfig,
  getConsent,
} from "@/lib/feedbackClient";

interface Source {
  label: string;
  timeline: TimelineFrame[];
  totalDuration: number;
  language?: string;
  mediaUrl?: string;
  mediaKind?: "audio" | "video";
}

const DEMO_SOURCE: Source = {
  label: "Demo · the “괜찮아” four-tone scene",
  timeline: DEMO_TIMELINE,
  totalDuration: DEMO_TIMELINE_DURATION,
};

// Streaming/playback tuning.
const PREBUFFER_SEC = 4; // start playback once this many seconds of timeline are ready
const PAUSE_MARGIN = 0.25; // pause if the playhead gets this close to the ready-horizon
const RESUME_MARGIN = 1.0; // resume once the horizon is this far ahead again

export default function Home() {
  const [source, setSource] = useState<Source>(DEMO_SOURCE);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Display toggles
  const [showSoundShape, setShowSoundShape] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  // The measurement readout is for us and for judges, not for a viewer. Being
  // able to switch it off mid-demo shows the two audiences side by side.
  const [showDetails, setShowDetails] = useState(true);
  // Rendering mode is switchable at runtime so the two can be compared on the
  // same clip without reprocessing. Seeded from the config so the default the
  // backend ships is the default seen here.
  const [renderMode, setRenderMode] = useState<RenderMode>(DEFAULT_RENDER_MODE);
  const [calibrating, setCalibrating] = useState(false);
  // Read after mount, never during render — localStorage does not exist on the
  // server and reading it while rendering would mismatch the hydrated markup.
  const [weights, setWeights] = useState<ChannelWeights | null>(null);
  useEffect(() => setWeights(loadWeights()), []);

  // Streaming state
  const [isProcessing, setIsProcessing] = useState(false); // stream open (head not yet ready)
  const [prebufferReady, setPrebufferReady] = useState(false);
  const [streamDone, setStreamDone] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Script mode: play a hand-written .srt instead of the model's interpretation.
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [scriptSrt, setScriptSrt] = useState("");

  // Low-confidence feedback loop: ask the viewer about moments the classifier
  // was unsure of, and use those answers to retrain on in-domain data.
  const [fbConfig, setFbConfig] = useState<FeedbackConfig | null>(null);
  const [fbConsent, setFbConsent] = useState<"granted" | "declined" | "unset">(
    "unset",
  );
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [promptNeedsConsent, setPromptNeedsConsent] = useState(false);
  const pacerRef = useRef<PromptPacer | null>(null);

  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(performance.now());
  const prevUrlRef = useRef<string | null>(null);
  // Live streaming progress, read inside the rAF clock without stale closures.
  const streamRef = useRef<{ horizon: number; done: boolean }>({
    horizon: Infinity,
    done: true,
  });
  const bufferingRef = useRef(false);

  const hasMedia = !!source.mediaUrl;

  // ── Clock A: demo free-running timer (only when NO media) ──
  useEffect(() => {
    if (hasMedia || !isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime((t) => (t + dt >= source.totalDuration ? 0 : t + dt));
      rafRef.current = requestAnimationFrame(tick);
    };
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [hasMedia, isPlaying, source.totalDuration]);

  // ── Clock B: real media element drives currentTime + buffer-health gating ──
  useEffect(() => {
    if (!hasMedia) return;
    const el = mediaRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => {
      setCurrentTime(el.currentTime);
      const { horizon, done } = streamRef.current;
      if (!done) {
        // Underrun guard: pause if the playhead catches up to processed audio.
        if (!el.paused && el.currentTime >= horizon - PAUSE_MARGIN) {
          el.pause();
          bufferingRef.current = true;
          setBuffering(true);
        } else if (
          bufferingRef.current &&
          horizon >= el.currentTime + RESUME_MARGIN
        ) {
          bufferingRef.current = false;
          setBuffering(false);
          el.play().catch(() => {});
        }
      } else if (bufferingRef.current) {
        bufferingRef.current = false;
        setBuffering(false);
        el.play().catch(() => {});
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [hasMedia, source.mediaUrl]);

  // Start playback once the prebuffer head is ready (or the stream finished).
  useEffect(() => {
    if (!hasMedia || prebufferReady) return;
    const { horizon, done } = streamRef.current;
    if (horizon >= PREBUFFER_SEC || done) {
      setPrebufferReady(true);
      const el = mediaRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => {});
      }
    }
  }, [source.timeline, streamDone, hasMedia, prebufferReady]);

  // Elapsed timer during the initial prebuffer.
  useEffect(() => {
    if (!isProcessing || prebufferReady || startedAt == null) return;
    const id = setInterval(() => setElapsedMs(performance.now() - startedAt), 100);
    return () => clearInterval(id);
  }, [isProcessing, prebufferReady, startedAt]);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (hasMedia) {
      const el = mediaRef.current;
      if (!el) return;
      if (el.paused) el.play().catch(() => {});
      else el.pause();
    } else {
      setIsPlaying((p) => !p);
    }
  }, [hasMedia]);

  const restart = useCallback(() => {
    if (hasMedia) {
      const el = mediaRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch(() => {});
      }
    } else {
      setCurrentTime(0);
    }
  }, [hasMedia]);

  const seek = useCallback(
    (t: number) => {
      if (hasMedia) {
        const el = mediaRef.current;
        if (el) el.currentTime = Math.max(0, Math.min(t, el.duration || t));
      } else {
        setCurrentTime(Math.max(0, Math.min(t, source.totalDuration)));
      }
    },
    [hasMedia, source.totalDuration],
  );

  const handleFile = useCallback(async (file: File) => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(file);
    prevUrlRef.current = url;

    streamRef.current = { horizon: 0, done: false };
    bufferingRef.current = false;
    setProcessingError(null);
    setStreamDone(false);
    setPrebufferReady(false);
    setBuffering(false);
    setIsProcessing(true);
    setStartedAt(performance.now());
    setElapsedMs(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setSource({
      label: `Uploaded · ${file.name}`,
      timeline: [],
      totalDuration: 0,
      mediaUrl: url,
      mediaKind: file.type.startsWith("video") ? "video" : "audio",
    });

    try {
      await processFileStream(file, {
        onMetadata: (m) =>
          setSource((s) => ({
            ...s,
            totalDuration: m.duration || s.totalDuration,
            language: m.language || s.language,
          })),
        onLanguage: (lang) => setSource((s) => ({ ...s, language: lang })),
        onSegment: (seg) => {
          streamRef.current.horizon = Math.max(
            streamRef.current.horizon,
            seg.t + seg.duration,
          );
          setSource((s) => ({ ...s, timeline: [...s.timeline, seg] }));
        },
        onDone: () => {
          streamRef.current.done = true;
          setStreamDone(true);
          setIsProcessing(false);
        },
        onError: (msg) => {
          setProcessingError(msg);
          streamRef.current.done = true;
          setIsProcessing(false);
        },
      });
    } catch (err) {
      setProcessingError(err instanceof Error ? err.message : String(err));
      streamRef.current.done = true;
      setIsProcessing(false);
    }
  }, []);

  // Play a user-authored script (.srt with [emotion] tags) synced to their
  // media, bypassing the ASR + emotion model entirely.
  const handleScript = useCallback((file: File, srt: string) => {
    const { timeline, totalDuration } = buildTimelineFromScript(srt);
    if (timeline.length === 0) {
      setProcessingError(
        "스크립트에서 자막을 찾지 못했어요. .srt 형식(번호 / 00:00:00,000 --> 00:00:00,000 / 텍스트)인지 확인해 주세요.",
      );
      return;
    }
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(file);
    prevUrlRef.current = url;
    streamRef.current = { horizon: Infinity, done: true };
    bufferingRef.current = false;
    setProcessingError(null);
    setIsProcessing(false);
    setStreamDone(true);
    setPrebufferReady(false); // lets the start effect play the media
    setBuffering(false);
    setCurrentTime(0);
    setIsPlaying(false);
    setSource({
      label: `Script · ${file.name}`,
      timeline,
      totalDuration,
      mediaUrl: url,
      mediaKind: file.type.startsWith("video") ? "video" : "audio",
    });
  }, []);

  const backToDemo = useCallback(() => {
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    streamRef.current = { horizon: Infinity, done: true };
    bufferingRef.current = false;
    setSource(DEMO_SOURCE);
    setCurrentTime(0);
    setIsPlaying(true);
    setProcessingError(null);
    setIsProcessing(false);
    setPrebufferReady(false);
    setStreamDone(false);
    setBuffering(false);
  }, []);

  // Load prompt settings from the backend once (single source of truth), and
  // read the stored consent decision.
  useEffect(() => {
    let cancelled = false;
    void fetchFeedbackConfig().then((cfg) => {
      if (cancelled || !cfg?.enabled) return;
      setFbConfig(cfg);
      pacerRef.current = new PromptPacer(
        cfg.min_interval_seconds,
        cfg.max_prompts_per_video,
      );
    });
    setFbConsent(getConsent());
    return () => {
      cancelled = true;
    };
  }, []);

  // New media → the per-video prompt budget starts over.
  useEffect(() => {
    pacerRef.current?.resetForNewVideo();
    setActivePrompt(null);
  }, [source.mediaUrl, source.label]);

  const currentFrame = useMemo(
    () => getCurrentFrame(source.timeline, currentTime),
    [source.timeline, currentTime],
  );

  // Surface a prompt when playback reaches a segment the classifier was
  // unsure about. Pacing (interval, per-video cap, no repeats) lives in
  // PromptPacer; this effect only decides "now, this one".
  useEffect(() => {
    if (!fbConfig || fbConsent === "declined" || activePrompt) return;
    const id = currentFrame?.emotion?.feedback_id;
    if (!id) return;
    const pacer = pacerRef.current;
    if (!pacer?.canShow(id)) return;
    pacer.markShown(id);
    setPromptNeedsConsent(fbConsent === "unset");
    setActivePrompt(id);
  }, [currentFrame, fbConfig, fbConsent, activePrompt]);

  const visual = useMemo(
    () =>
      mapEmotionToVisual(
        currentFrame?.emotion ??
          source.timeline[0]?.emotion ??
          DEMO_TIMELINE[0].emotion,
        currentFrame?.prosody,
        currentFrame?.reference,
        renderMode,
        weights,
      ),
    [currentFrame, source.timeline, renderMode, weights],
  );
  // Confidence is handed to the renderer as its own value rather than folded
  // into colour: in hybrid mode saturation already means measured arousal, so
  // dimming it for doubt made "calm voice" and "unsure classifier" look the same.
  const fieldVisual = useMemo(
    () => ({
      ...visual,
      uncertainty:
        currentFrame?.emotion?.confidence == null
          ? 0
          : Math.max(0, Math.min(1, 1 - currentFrame.emotion.confidence / 0.85)),
    }),
    [visual, currentFrame],
  );


  const isDemo = source === DEMO_SOURCE;
  const isVideo = source.mediaKind === "video";
  const showPrebufferOverlay = isProcessing && !prebufferReady;
  const processedPct =
    source.totalDuration > 0 && hasMedia
      ? Math.min(100, (streamRef.current.horizon / source.totalDuration) * 100)
      : 0;

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-zinc-900 via-zinc-950 to-black px-4 py-10 text-white">
      <header className="mb-6 w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">SoundShape</h1>
        <p className="text-sm text-white/50">
          Captions tell you <em>what</em> was said. SoundShape shows you{" "}
          <em>how</em>.
        </p>
      </header>

      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6">
        {isDemo ? (
          <FileUpload onFile={handleFile} disabled={isProcessing} />
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
            <div className="flex min-w-0 items-center gap-3 text-white/80">
              <span
                className={[
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  streamDone ? "bg-emerald-400" : "animate-pulse bg-amber-400",
                ].join(" ")}
              />
              <span className="truncate">
                {source.label}
                {source.language ? (
                  <span className="ml-2 text-white/40">({source.language})</span>
                ) : null}
                {!streamDone && (
                  <span className="ml-2 text-white/40">
                    · analyzing {processedPct.toFixed(0)}%
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={backToDemo}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
            >
              ← demo
            </button>
          </div>
        )}

        {isDemo && (
          <details className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <summary className="cursor-pointer select-none text-white/70">
              ✎ 내 스크립트로 재생 (.srt) — 모델 해석 대신 내가 정한 자막·감정으로
            </summary>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-white/50">
                  1. 영상/오디오 파일
                </label>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white/80"
                />
                {scriptFile && (
                  <div className="mt-1 truncate text-xs text-white/40">
                    {scriptFile.name}
                  </div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-white/50">
                  2. 스크립트 (.srt · 각 줄 앞에 [비꼼]/[진심]/[분노] 등 태그 가능)
                </label>
                <input
                  type="file"
                  accept=".srt,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) f.text().then(setScriptSrt);
                  }}
                  className="mb-2 block w-full text-xs text-white/70 file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-white/80"
                />
                <textarea
                  value={scriptSrt}
                  onChange={(e) => setScriptSrt(e.target.value)}
                  rows={6}
                  placeholder={
                    "1\n00:00:00,300 --> 00:00:02,600\n[비꼼] And so what? You convince me,\n\n2\n00:00:02,600 --> 00:00:05,000\n[비꼼] maybe tonight we just sneak in and shampoo her carpet."
                  }
                  className="w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-xs leading-relaxed text-white/80 placeholder:text-white/25"
                />
                <div className="mt-1 text-xs text-white/35">
                  태그: 비꼼·진심·위로·분노·짜증·슬픔·체념·놀람·기쁨·공포·중립
                </div>
              </div>
              <button
                type="button"
                disabled={!scriptFile || !scriptSrt.trim()}
                onClick={() => scriptFile && handleScript(scriptFile, scriptSrt)}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▶ 내 스크립트로 재생
              </button>
            </div>
          </details>
        )}

        {processingError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="font-medium">Processing failed</div>
            <div className="mt-1 text-red-200/80">{processingError}</div>
            <div className="mt-2 text-xs text-red-200/60">
              Hint: is the backend running? (
              <code className="rounded bg-black/40 px-1">
                uvicorn backend.api.main:app --port 8000
              </code>
              )
            </div>
          </div>
        )}

        {/* Stage */}
        <section className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl">
          {hasMedia && isVideo && (
            <video
              ref={(el) => {
                mediaRef.current = el;
              }}
              src={source.mediaUrl}
              className="absolute inset-0 h-full w-full object-contain"
              playsInline
            />
          )}
          {hasMedia && !isVideo && (
            <audio
              ref={(el) => {
                mediaRef.current = el;
              }}
              src={source.mediaUrl}
            />
          )}

          {/* The calibration test needs its own WebGL contexts and this one
              is behind a full-screen dialog anyway. Releasing it while the
              test runs keeps the stimuli on the real renderer instead of the
              shape-less 2D fallback. */}
          {showSoundShape &&
            !calibrating &&
            (isVideo ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-[15%] h-[36%] opacity-95">
                <EmotionCanvas
                  visual={fieldVisual}
                  changedAt={currentFrame?.t ?? 0}
                  transparent
                />
              </div>
            ) : (
              // The wave draws down the middle of its own canvas, so the
              // canvas is a band rather than the whole frame: centred at ~33%
              // from the bottom, which sits it just above the caption line at
              // 13% instead of splitting the picture in half.
              <div className="pointer-events-none absolute inset-x-0 bottom-[15%] h-[36%]">
                {/* Transparent, like the video overlay. The canvas used to fill
                    the frame, so its own tinted background went unnoticed; as a
                    band it would draw a visible rectangle against the player. */}
                <EmotionCanvas
                  visual={fieldVisual}
                  changedAt={currentFrame?.t ?? 0}
                  transparent
                />
              </div>
            ))}

          {/* Initial prebuffer overlay */}
          {showPrebufferOverlay && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
              <div
                className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white"
                aria-label="loading"
              />
              <p className="text-sm text-white/80">
                Analyzing the opening… {(elapsedMs / 1000).toFixed(1)} s
              </p>
              <p className="text-xs text-white/40">
                FFmpeg → Whisper → PRAAT → wav2vec2 — then playback starts
              </p>
            </div>
          )}

          {/* Mid-playback buffering nudge */}
          {buffering && !showPrebufferOverlay && (
            <div className="absolute right-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              buffering…
            </div>
          )}

          {showCaptions && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[13%] flex justify-center px-6">
              <SubtitleLayer frame={currentFrame} currentTime={currentTime} />
            </div>
          )}
        </section>

        <ControlPanel
          showSoundShape={showSoundShape}
          onToggleSoundShape={() => setShowSoundShape((v) => !v)}
          showCaptions={showCaptions}
          onToggleCaptions={() => setShowCaptions((v) => !v)}
          showLegend={showLegend}
          onToggleLegend={() => setShowLegend((v) => !v)}
          renderMode={renderMode}
          renderModeAvailable={currentFrame?.prosody != null}
          onToggleRenderMode={() =>
            setRenderMode((m) => (m === "hybrid" ? "full_ai" : "hybrid"))
          }
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails((v) => !v)}
        />

        {showLegend && <Legend />}

        <button
          type="button"
          onClick={() => setCalibrating(true)}
          className="self-start text-xs text-white/35 underline-offset-4 transition hover:text-white/70 hover:underline"
        >
          시각 표현 맞춤 설정 (약 2분 30초)
        </button>

        {calibrating && (
          <CalibrationTest
            onClose={() => {
              setCalibrating(false);
              setWeights(loadWeights()); // pick up a result just produced
            }}
          />
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Emotion timeline</span>
            <span>color = mapped HSL · width = duration</span>
          </div>
          <EmotionTimeline
            timeline={source.timeline}
            totalDuration={source.totalDuration || DEMO_TIMELINE_DURATION}
            currentTime={currentTime}
            onSeek={seek}
          />
        </section>

        <Player
          isPlaying={isPlaying}
          currentTime={currentTime}
          totalDuration={source.totalDuration || DEMO_TIMELINE_DURATION}
          onTogglePlay={togglePlay}
          onRestart={restart}
        />

        {currentFrame && showDetails && (
          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/60">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <Field label="Category" value={currentFrame.emotion.category} />
              <Field
                label="Valence"
                value={currentFrame.emotion.valence.toFixed(2)}
              />
              <Field
                label="Arousal"
                value={currentFrame.emotion.arousal.toFixed(2)}
              />
              <Field label="Shape" value={visual.shape} />
            </div>
            {currentFrame.prosody && (
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-white/5 pt-3 sm:grid-cols-4">
                <Field
                  label="F0 mean"
                  value={`${currentFrame.prosody.f0_mean.toFixed(0)} Hz`}
                />
                <Field
                  label="F0 range"
                  value={`${currentFrame.prosody.f0_range.toFixed(0)} Hz`}
                />
                <Field
                  label="Intensity"
                  value={currentFrame.prosody.intensity_mean.toFixed(1)}
                />
                <Field
                  label="Jitter"
                  value={currentFrame.prosody.jitter_local.toFixed(3)}
                />
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="mt-10 text-xs text-white/30">
        SoundShape · KCF 2026 · streaming (prebuffer + lookahead)
      </footer>

      {activePrompt && fbConfig && (
        <FeedbackPrompt
          key={activePrompt}
          feedbackId={activePrompt}
          config={fbConfig}
          needsConsent={promptNeedsConsent}
          onClose={() => setActivePrompt(null)}
          onConsentDecided={(granted) => {
            setFbConsent(granted ? "granted" : "declined");
            // Consent replaced this prompt; ask again at the next uncertain
            // moment rather than switching cards under the viewer.
            setActivePrompt(null);
          }}
        />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/40">{label}</span>
      <br />
      <span className="text-white">{value}</span>
    </div>
  );
}
