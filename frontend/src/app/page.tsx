"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { EmotionTimeline } from "@/components/EmotionTimeline";
import { FileUpload } from "@/components/FileUpload";
import { Player } from "@/components/Player";
import { SubtitleLayer } from "@/components/SubtitleLayer";
import { processFile } from "@/lib/api";
import { mapEmotionToVisual } from "@/lib/mapping";
import {
  DEMO_TIMELINE,
  DEMO_TIMELINE_DURATION,
  getCurrentFrame,
} from "@/lib/timeline";
import type { Timeline, TimelineFrame } from "@/types/emotion";

interface Source {
  label: string; // shown in the header strip
  timeline: TimelineFrame[];
  totalDuration: number;
  language?: string;
}

const DEMO_SOURCE: Source = {
  label: "Demo · the “괜찮아” four-tone scene",
  timeline: DEMO_TIMELINE,
  totalDuration: DEMO_TIMELINE_DURATION,
};

export default function Home() {
  const [source, setSource] = useState<Source>(DEMO_SOURCE);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(
    null,
  );
  const [elapsedMs, setElapsedMs] = useState(0);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(performance.now());

  // ────── playback rAF loop ──────
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = (now: number) => {
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCurrentTime((t) => {
        const next = t + dt;
        return next >= source.totalDuration ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, source.totalDuration]);

  // ────── elapsed timer during upload ──────
  useEffect(() => {
    if (!isProcessing || processingStartedAt == null) return;
    const id = setInterval(() => {
      setElapsedMs(performance.now() - processingStartedAt);
    }, 100);
    return () => clearInterval(id);
  }, [isProcessing, processingStartedAt]);

  const handleFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setProcessingError(null);
    setProcessingStartedAt(performance.now());
    setElapsedMs(0);
    try {
      const result: Timeline = await processFile(file);
      if (!result.segments.length) {
        throw new Error("Pipeline returned 0 segments — was the file silent?");
      }
      setSource({
        label: `Uploaded · ${file.name}`,
        timeline: result.segments,
        totalDuration: result.metadata.duration,
        language: result.metadata.language,
      });
      setCurrentTime(0);
      setIsPlaying(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProcessingError(msg);
    } finally {
      setIsProcessing(false);
      setProcessingStartedAt(null);
    }
  }, []);

  const backToDemo = useCallback(() => {
    setSource(DEMO_SOURCE);
    setCurrentTime(0);
    setIsPlaying(true);
    setProcessingError(null);
  }, []);

  const currentFrame = useMemo(
    () => getCurrentFrame(source.timeline, currentTime),
    [source.timeline, currentTime],
  );

  const visual = useMemo(
    () =>
      mapEmotionToVisual(
        currentFrame?.emotion ?? source.timeline[0]?.emotion ?? DEMO_TIMELINE[0].emotion,
      ),
    [currentFrame, source.timeline],
  );

  const isDemo = source === DEMO_SOURCE;

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-zinc-900 via-zinc-950 to-black px-4 py-10 text-white">
      <header className="mb-6 w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">SoundShape</h1>
        <p className="text-sm text-white/50">
          Phase 4 · upload your own audio, or watch the demo
        </p>
      </header>

      <main className="flex w-full max-w-3xl flex-1 flex-col gap-6">
        {/* Upload zone or "back to demo" pill */}
        {isDemo ? (
          <FileUpload onFile={handleFile} disabled={isProcessing} />
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
            <div className="flex items-center gap-3 text-white/80">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              <span className="truncate">
                {source.label}
                {source.language ? (
                  <span className="ml-2 text-white/40">
                    ({source.language})
                  </span>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              onClick={backToDemo}
              className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
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
              Hint: make sure the backend is running (
              <code className="rounded bg-black/40 px-1">
                uvicorn backend.api.main:app --port 8000
              </code>
              ).
            </div>
          </div>
        )}

        {/* Stage */}
        <section className="relative aspect-video w-full">
          <EmotionCanvas visual={visual} changedAt={currentFrame?.t ?? 0} />
          {isProcessing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/70 backdrop-blur-sm">
              <Spinner />
              <p className="text-sm text-white/80">
                Processing · {(elapsedMs / 1000).toFixed(1)} s
              </p>
              <p className="text-xs text-white/40">
                FFmpeg → Whisper → PRAAT → wav2vec2 → timeline
              </p>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
            <SubtitleLayer frame={currentFrame} />
          </div>
        </section>

        {/* Emotion strip */}
        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Emotion timeline</span>
            <span>color = mapped HSL · width = duration</span>
          </div>
          <EmotionTimeline
            timeline={source.timeline}
            totalDuration={source.totalDuration}
            currentTime={currentTime}
          />
        </section>

        {/* Controls */}
        <Player
          isPlaying={isPlaying}
          currentTime={currentTime}
          totalDuration={source.totalDuration}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onRestart={() => setCurrentTime(0)}
        />

        {/* Debug panel */}
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
        SoundShape · KCF 2026 · Phase 4 end-to-end MVP
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

function Spinner() {
  return (
    <div
      className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white"
      aria-label="loading"
    />
  );
}
