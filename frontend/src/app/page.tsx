"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "@/components/ControlPanel";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { EmotionTimeline } from "@/components/EmotionTimeline";
import { FileUpload } from "@/components/FileUpload";
import { Legend } from "@/components/Legend";
import { Player } from "@/components/Player";
import { SubtitleLayer } from "@/components/SubtitleLayer";
import { processFileStream } from "@/lib/api";
import { mapEmotionToVisual } from "@/lib/mapping";
import {
  DEMO_TIMELINE,
  DEMO_TIMELINE_DURATION,
  getCurrentFrame,
} from "@/lib/timeline";
import type { TimelineFrame } from "@/types/emotion";

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

  // Streaming state
  const [isProcessing, setIsProcessing] = useState(false); // stream open (head not yet ready)
  const [prebufferReady, setPrebufferReady] = useState(false);
  const [streamDone, setStreamDone] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

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

  const currentFrame = useMemo(
    () => getCurrentFrame(source.timeline, currentTime),
    [source.timeline, currentTime],
  );

  const visual = useMemo(
    () =>
      mapEmotionToVisual(
        currentFrame?.emotion ??
          source.timeline[0]?.emotion ??
          DEMO_TIMELINE[0].emotion,
        currentFrame?.prosody,
      ),
    [currentFrame, source.timeline],
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

          {showSoundShape &&
            (isVideo ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 h-2/5 opacity-95">
                <EmotionCanvas
                  visual={visual}
                  changedAt={currentFrame?.t ?? 0}
                  transparent
                />
              </div>
            ) : (
              <div className="absolute inset-0">
                <EmotionCanvas visual={visual} changedAt={currentFrame?.t ?? 0} />
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
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-6">
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
        />

        {showLegend && <Legend />}

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

        {currentFrame && (
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
