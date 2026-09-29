"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ControlPanel } from "@/components/ControlPanel";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { EmotionTimeline } from "@/components/EmotionTimeline";
import { FileUpload } from "@/components/FileUpload";
import { CalibrationCard } from "@/components/CalibrationCard";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { CalibrationTest } from "@/components/CalibrationTest";
import { Legend } from "@/components/Legend";
import { Player } from "@/components/Player";
import { SubtitleLayer } from "@/components/SubtitleLayer";
import { SourceRow } from "@/components/SourceRow";
import { Eyebrow, SourceDot, SrOnly } from "@/components/ui";
import { emotionName, shapeName, useLocale, useT } from "@/lib/i18n";
import {
  hasUploaded,
  hasUploadedOnServer,
  markUploaded,
  subscribeUploaded,
} from "@/lib/uploadMemory";
import { processFileStream } from "@/lib/api";
import { clearWeights, loadWeights } from "@/lib/calibrationStore";
import {
  DEFAULT_RENDER_MODE,
  mapEmotionToVisual,
  type ChannelWeights,
  type RenderMode,
} from "@/lib/mapping";
import {
  DEMO_PROSODY_IS_SYNTHETIC,
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
  ASK_CONSENT_EVERY_LOAD,
  clearStoredConsent,
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
  label: "__demo__",
  timeline: DEMO_TIMELINE,
  totalDuration: DEMO_TIMELINE_DURATION,
};

// Streaming/playback tuning.
const PREBUFFER_SEC = 4; // start playback once this many seconds of timeline are ready
const PAUSE_MARGIN = 0.25; // pause if the playhead gets this close to the ready-horizon
const RESUME_MARGIN = 1.0; // resume once the horizon is this far ahead again

export default function Home() {
  const t = useT();
  const locale = useLocale();
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
  // The dropzone is onboarding, not furniture: it holds the rail until the
  // viewer has picked a file once, after which the compact SourceRow with its
  // "다른 파일" button takes over. See lib/uploadMemory.
  const hasEverUploaded = useSyncExternalStore(
    subscribeUploaded,
    hasUploaded,
    hasUploadedOnServer,
  );
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
    // Named `time` rather than `t`, which is now the string table.
    (time: number) => {
      if (hasMedia) {
        const el = mediaRef.current;
        if (el) el.currentTime = Math.max(0, Math.min(time, el.duration || time));
      } else {
        setCurrentTime(Math.max(0, Math.min(time, source.totalDuration)));
      }
    },
    [hasMedia, source.totalDuration],
  );

  // Transport from the keyboard. Presenting this live means driving it while
  // talking, and hunting for a button mid-sentence is the part that looks
  // unrehearsed; it also gives the page a play control that does not require
  // a mouse. Skipped whenever focus is in a text field — the script box is
  // full of spaces — and whenever the timeline slider has focus, which owns
  // the arrow keys itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `instanceof` rather than a cast: the target is an Element for every
      // real keypress, but not for a synthetic event dispatched on window, and
      // getAttribute on that throws straight out of the listener.
      const el = e.target instanceof HTMLElement ? e.target : null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        el?.isContentEditable ||
        el?.getAttribute("role") === "slider"
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.code === "Space" || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(currentTime + (e.shiftKey ? 5 : 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(currentTime - (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seek, currentTime]);

  const handleFile = useCallback(async (file: File) => {
    if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
    const url = URL.createObjectURL(file);
    prevUrlRef.current = url;

    // Onboarding is over the moment a file is picked, whether or not the
    // processing that follows succeeds — the viewer has demonstrably found the
    // control, so the dropzone has done its job.
    markUploaded();

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
      label: file.name,
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
    // Ask-every-load mode keeps its answer in memory, so drop anything an
    // earlier build wrote — otherwise a stale "granted" would come back the
    // moment the switch is flipped off.
    if (ASK_CONSENT_EVERY_LOAD) clearStoredConsent();
    setFbConsent(getConsent());
    return () => {
      cancelled = true;
    };
  }, []);

  // New media → the per-video prompt budget starts over.
  //
  // A consent card is the exception: it asks about the viewer, not about the
  // clip, so loading a file must not yank it away mid-decision. The read is a
  // ref so that answering consent does not itself re-run this effect.
  const needsConsentRef = useRef(false);
  useEffect(() => {
    needsConsentRef.current = promptNeedsConsent;
  }, [promptNeedsConsent]);

  useEffect(() => {
    pacerRef.current?.resetForNewVideo();
    setActivePrompt((cur) => (cur && needsConsentRef.current ? cur : null));
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
  // Shown only while the viewer has never picked a file AND the built-in demo
  // is still what is playing — once either is false the rail shows SourceRow.
  const showDropzone = isDemo && !hasEverUploaded;
  const isVideo = source.mediaKind === "video";
  const showPrebufferOverlay = isProcessing && !prebufferReady;
  const processedPct =
    source.totalDuration > 0 && hasMedia
      ? Math.min(100, (streamRef.current.horizon / source.totalDuration) * 100)
      : 0;

  return (
    <div className="mx-auto w-full max-w-[1180px] flex-1 px-8 py-9">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div>
          <h1 className="text-[32px] font-semibold leading-none tracking-[-0.02em]">
            SoundShape
          </h1>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-muted">
            {t.tagline.lead}
            <b className="font-semibold text-ink">{t.tagline.what}</b>
            {t.tagline.mid}
            <b className="font-semibold text-ink">{t.tagline.how}</b>
            {t.tagline.tail}
          </p>
        </div>
        {/* Controls live in the masthead rather than under the stage: they are
            about how to READ the thing below, so they belong above it. */}
        <div className="pt-1">
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
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
        {/* ── Stage column ── */}
        <main className="lg:col-span-8">
          {processingError && (
            <div
              className="mb-4 rounded-lg px-4 py-3 text-[12px]"
              style={{
                background: "var(--danger-tint)",
                border: "1px solid var(--danger)",
                color: "var(--danger)",
              }}
            >
              <div className="font-medium">{t.errors.failed}</div>
              <div className="mt-1">{processingError}</div>
              <div className="mt-2 text-[11px] text-muted">
                {t.errors.backendHint}{" "}
                <code className="tnum rounded bg-well px-1">
                  uvicorn backend.api.main:app --port 8000
                </code>
              </div>
            </div>
          )}

          {/* The stage. Light ground: the field writes non-premultiplied alpha
              with lightness capped well short of white, so it composites onto
              paper as coloured ink. The renderer itself is untouched. */}
          {/* 16:9 only when there is actually a picture in it. With audio the
              frame held a thin waveform in the middle of a large empty
              rectangle — the biggest element on the page was also the emptiest,
              which is most of what made the app read as unfinished. A 21:9 band
              is the shape of the thing being shown. */}
          <section
            className="relative overflow-hidden rounded-lg"
            style={{
              background: "var(--well)",
              aspectRatio: isVideo ? "16 / 9" : "21 / 9",
            }}
          >
            {/* The emotion field is the entire product and, until now, the one
                thing on the page with no text equivalent — a bare <canvas>
                with no role and no label. The live region says what the field
                is currently showing, so the information it carries exists in
                text as well as in light. Keyed to the segment rather than the
                frame so it announces once per reading, not sixty times a
                second. */}
            <SrOnly live="polite">
              {currentFrame
                ? t.stage.nowPlaying(
                    emotionName(currentFrame.emotion.category, locale),
                    shapeName(visual.shape, locale),
                  )
                : ""}
            </SrOnly>
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
            {showSoundShape && !calibrating && (
              <div
                className="pointer-events-none absolute inset-x-0"
                style={
                  isVideo
                    ? { bottom: "24%", height: "36%" }
                    : { bottom: "30%", height: "44%" }
                }
              >
                <div
                  role="img"
                  aria-label={t.stage.fieldLabel(
                    currentFrame
                      ? emotionName(currentFrame.emotion.category, locale)
                      : "",
                  )}
                  className="h-full w-full"
                >
                  <EmotionCanvas
                    visual={fieldVisual}
                    changedAt={currentFrame?.t ?? 0}
                    transparent
                  />
                </div>
              </div>
            )}

            {showPrebufferOverlay && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                style={{ background: "color-mix(in srgb, var(--well) 88%, transparent)" }}
              >
                <div
                  className="h-7 w-7 animate-spin rounded-full border-2"
                  style={{
                    borderColor: "var(--line-strong)",
                    borderTopColor: "var(--accent)",
                  }}
                  aria-label="분석 중"
                />
                <p className="tnum text-[12px] text-muted">
                  {t.stage.analyzingHead((elapsedMs / 1000).toFixed(1))}
                </p>
                <p className="eyebrow">{t.stage.pipeline}</p>
              </div>
            )}

            {buffering && !showPrebufferOverlay && (
              <div
                className="absolute right-3 top-3 flex items-center gap-2 rounded-full px-3 py-1 text-[11px] text-muted"
                style={{ background: "var(--raised)", border: "1px solid var(--line)" }}
              >
                <span
                  className="h-3 w-3 animate-spin rounded-full border-2"
                  style={{
                    borderColor: "var(--line-strong)",
                    borderTopColor: "var(--accent)",
                  }}
                />
                {t.stage.buffering}
              </div>
            )}

            {showCaptions && (
              <div
                className="pointer-events-none absolute inset-x-0 flex justify-center px-6"
                style={{ bottom: isVideo ? "8%" : "10%" }}
              >
                <SubtitleLayer frame={currentFrame} currentTime={currentTime} />
              </div>
            )}
          </section>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <Player
              isPlaying={isPlaying}
              currentTime={currentTime}
              totalDuration={source.totalDuration || DEMO_TIMELINE_DURATION}
              onTogglePlay={togglePlay}
              onRestart={restart}
            />
            <span className="tnum hidden text-[10px] text-faint sm:block">
              {t.keys.help}
            </span>
          </div>

          <section className="mt-7">
            <div className="mb-2.5 flex items-baseline justify-between">
              <Eyebrow>{t.sections.timeline}</Eyebrow>
              <span className="text-[10px] text-faint">
                {t.sections.timelineNote}
              </span>
            </div>
            <EmotionTimeline
              timeline={source.timeline}
              totalDuration={source.totalDuration || DEMO_TIMELINE_DURATION}
              currentTime={currentTime}
              onSeek={seek}
            />
          </section>

          <div className="mt-8">
            <CalibrationCard
              weights={weights}
              onStart={() => setCalibrating(true)}
              onReset={() => {
                clearWeights();
                setWeights(null);
              }}
            />
          </div>

          {isDemo && (
            <details className="mt-7 border-t border-line pt-4 text-[12px]">
              <summary className="cursor-pointer select-none text-muted transition hover:text-ink">
                {t.script.summary}
              </summary>
              <div className="mt-4 space-y-4">
                <div>
                  <Eyebrow className="mb-1.5">{t.script.step1}</Eyebrow>
                  <input
                    type="file"
                    accept="audio/*,video/*"
                    onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-[11px] text-muted file:mr-3 file:rounded-full file:border file:border-line file:bg-transparent file:px-3 file:py-1 file:text-[11px] file:text-ink"
                  />
                  {scriptFile && (
                    <div className="mt-1 truncate text-[11px] text-faint">
                      {scriptFile.name}
                    </div>
                  )}
                </div>
                <div>
                  <Eyebrow className="mb-1.5">{t.script.step2}</Eyebrow>
                  <input
                    type="file"
                    accept=".srt,text/plain"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) f.text().then(setScriptSrt);
                    }}
                    className="mb-2 block w-full text-[11px] text-muted file:mr-3 file:rounded-full file:border file:border-line file:bg-transparent file:px-3 file:py-1 file:text-[11px] file:text-ink"
                  />
                  <textarea
                    value={scriptSrt}
                    onChange={(e) => setScriptSrt(e.target.value)}
                    rows={6}
                    placeholder={
                      "1\n00:00:00,300 --> 00:00:02,600\n[비꼼] And so what? You convince me,"
                    }
                    className="tnum w-full rounded border border-line bg-raised p-2 text-[11px] leading-relaxed text-ink placeholder:text-faint"
                  />
                  <div className="mt-1 text-[10px] text-faint">
                    {t.script.tags}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!scriptFile || !scriptSrt.trim()}
                  onClick={() => scriptFile && handleScript(scriptFile, scriptSrt)}
                  className="rounded-full bg-ink px-4 py-1.5 text-[11px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t.script.play}
                </button>
              </div>
            </details>
          )}
        </main>

        {/* ── Right rail. Rules, not boxes. ── */}
        <aside className="space-y-8 lg:col-span-4">
          <section>
            <Eyebrow className="mb-2.5">{t.sections.source}</Eyebrow>
            {showDropzone ? (
              <FileUpload onFile={handleFile} disabled={isProcessing} />
            ) : (
              <SourceRow
                label={isDemo ? t.demo.sourceLabel : source.label}
                detail={
                  [
                    t.upload.seconds(
                      (source.totalDuration || DEMO_TIMELINE_DURATION).toFixed(1),
                    ),
                    source.language ?? (isDemo ? (locale === "ko" ? "한국어" : "Korean") : undefined),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }
                progressPct={hasMedia && !streamDone ? processedPct : null}
                onFile={handleFile}
                onBackToDemo={isDemo ? undefined : backToDemo}
                disabled={isProcessing}
              />
            )}
          </section>

          {showDetails && currentFrame && (
            <section>
              <Eyebrow className="mb-2.5">{t.sections.readout}</Eyebrow>

              {/* Grouped by SOURCE rather than listed flat. The eight rows used
                  to be one undifferentiated table with a coloured dot on each,
                  so the project's central distinction — what was measured off
                  the voice versus what a classifier guessed — had to be
                  reassembled by the reader from eight small dots. As two
                  labelled groups it is the first thing the panel says. The
                  per-row dots go away with it: the heading carries the meaning
                  once instead of eight times. */}
              <SourceGroup label={t.readout.inferred} source="inferred">
                <Row
                  label={t.readout.emotion}
                  value={emotionName(currentFrame.emotion.category, locale)}
                />
                <Row
                  label={t.readout.valence}
                  value={currentFrame.emotion.valence.toFixed(2)}
                  numeric
                />
                <Row
                  label={t.readout.arousal}
                  value={currentFrame.emotion.arousal.toFixed(2)}
                  numeric
                />
                <Row label={t.readout.shape} value={shapeName(visual.shape, locale)} />
                {currentFrame.emotion.confidence != null && (
                  <ConfidenceBar confidence={currentFrame.emotion.confidence} />
                )}
              </SourceGroup>

              {currentFrame.prosody && (
                <div className="mt-5">
                  <SourceGroup label={t.readout.measured} source="measured">
                    {/* Ordered by the config's own fitted weights — F0 mean
                        .40, intensity .25, F0 range .20, jitter last — so the
                        column still ranks them even though they now share a
                        size. */}
                    <Row
                      label={t.readout.f0mean}
                      value={`${currentFrame.prosody.f0_mean.toFixed(0)} Hz`}
                      numeric
                    />
                    <Row
                      label={t.readout.intensity}
                      value={`${currentFrame.prosody.intensity_mean.toFixed(1)} dB`}
                      numeric
                    />
                    <Row
                      label={t.readout.f0range}
                      value={`${currentFrame.prosody.f0_range.toFixed(0)} Hz`}
                      numeric
                    />
                    <Row
                      label={t.readout.jitter}
                      value={currentFrame.prosody.jitter_local.toFixed(3)}
                      numeric
                    />
                  </SourceGroup>
                </div>
              )}

              {/* The demo scene has no recording behind it, so its prosody is
                  illustrative. Saying so is not a weakness to hide: a judge who
                  finds an unlabelled number that was never measured stops
                  believing the measured ones too. */}
              {isDemo && DEMO_PROSODY_IS_SYNTHETIC && currentFrame.prosody && (
                <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
                  {t.readout.syntheticNote}
                </p>
              )}
            </section>
          )}

          {showLegend && (
            <section>
              <Eyebrow className="mb-2.5">{t.sections.legendTitle}</Eyebrow>
              <p className="mb-3 text-[11px] leading-relaxed text-faint">
                {t.sections.legendNote}
              </p>
              <Legend />
            </section>
          )}

        </aside>
      </div>

      {calibrating && (
        <CalibrationTest
          onClose={() => {
            setCalibrating(false);
            setWeights(loadWeights()); // pick up a result just produced
          }}
        />
      )}

      <footer className="mt-12 border-t border-line pt-4">
        <Eyebrow>{t.footer}</Eyebrow>
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

/** A labelled block of rows that all came from the same place. */
function SourceGroup({
  label,
  source,
  children,
}: {
  label: string;
  source: "measured" | "inferred";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <SourceDot source={source} />
        <span className="eyebrow">{label}</span>
      </div>
      <dl>{children}</dl>
    </div>
  );
}

/**
 * One readout line.
 *
 * `numeric` sets every measured or scored value at the same display size —
 * this is a readout, and a readout's job is to let you read the numbers from
 * a step back. Labels stay small and quiet so the column reads as values with
 * annotations rather than as a table of equal-weight cells. The two rows whose
 * values are words (category, shape) keep body size: blown up to 20px they
 * wrap and out-shout the measurements, and they are the two things the
 * classifier GUESSED, so they are the last things that should shout.
 */
function Row({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-[7px]">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        className={
          numeric ? "tnum text-[20px] leading-none" : "tnum text-[13px]"
        }
      >
        {value}
      </dd>
    </div>
  );
}
