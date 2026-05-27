"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { EmotionTimeline } from "@/components/EmotionTimeline";
import { Player } from "@/components/Player";
import { SubtitleLayer } from "@/components/SubtitleLayer";
import { mapEmotionToVisual } from "@/lib/mapping";
import {
  DEMO_TIMELINE,
  DEMO_TIMELINE_DURATION,
  getCurrentFrame,
} from "@/lib/timeline";

export default function Home() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(performance.now());

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
        return next >= DEMO_TIMELINE_DURATION ? 0 : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  const currentFrame = useMemo(
    () => getCurrentFrame(DEMO_TIMELINE, currentTime),
    [currentTime],
  );

  const visual = useMemo(
    () => mapEmotionToVisual(currentFrame?.emotion ?? DEMO_TIMELINE[0].emotion),
    [currentFrame],
  );

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-zinc-900 via-zinc-950 to-black px-4 py-10 text-white">
      <header className="mb-6 w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">SoundShape</h1>
        <p className="text-sm text-white/50">
          Phase 1 · hardcoded demo · the &quot;괜찮아&quot; four-tone scene
        </p>
      </header>

      <main className="flex w-full max-w-3xl flex-1 flex-col gap-8">
        <section className="relative aspect-video w-full">
          <EmotionCanvas visual={visual} changedAt={currentFrame?.t ?? 0} />
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-6">
            <SubtitleLayer frame={currentFrame} />
          </div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between text-xs text-white/40">
            <span>Emotion timeline</span>
            <span>color = mapped HSL · width = duration</span>
          </div>
          <EmotionTimeline
            timeline={DEMO_TIMELINE}
            totalDuration={DEMO_TIMELINE_DURATION}
            currentTime={currentTime}
          />
        </section>

        <Player
          isPlaying={isPlaying}
          currentTime={currentTime}
          totalDuration={DEMO_TIMELINE_DURATION}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onRestart={() => setCurrentTime(0)}
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
          </section>
        )}
      </main>

      <footer className="mt-10 text-xs text-white/30">
        SoundShape · KCF 2026 · Phase 1 hardcoded visual demo
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
