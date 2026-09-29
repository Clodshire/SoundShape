"use client";

import { useEffect, useRef } from "react";
import styles from "./site.module.css";
import type { Tone } from "./tones";

// 14 voice-memo bars. Each bar has its own period multiplier and phase so the
// CSS fallback never moves in lockstep (분노 fast and rough, 위로 slow).
const BARS = [0.22, 0.31, 0.19, 0.36, 0.25, 0.29, 0.2, 0.34, 0.23, 0.3, 0.18, 0.33, 0.26, 0.21];
const DELAYS = [0.05, 0.22, 0.41, 0.09, 0.33, 0.17, 0.48, 0.02, 0.29, 0.14, 0.44, 0.07, 0.38, 0.25];
// Which frequency band drives which bar — shuffled so the row reads as a
// voice, not as a left-to-right spectrum.
const BAND_FOR_BAR = [5, 2, 9, 0, 7, 3, 11, 1, 8, 4, 12, 6, 10, 13];
// How much each tone smooths the live signal: comfort glides, anger jitters.
const SMOOTHING: Record<string, number> = {
  comfort: 0.82,
  resignation: 0.72,
  sarcasm: 0.55,
  anger: 0.3,
};

interface Props {
  tone: Tone;
  // Live analyser on the playing media; null → CSS approximation.
  analyser: AnalyserNode | null;
  // Someone is speaking right now (between lines the bars rest).
  speaking: boolean;
  playing: boolean;
  width?: number;
  height?: number;
}

export function Waveform({ tone, analyser, speaking, playing, width = 150, height = 45 }: Props) {
  const rects = useRef<(SVGRectElement | null)[]>([]);
  const toneRef = useRef(tone.id);
  toneRef.current = tone.id;

  const live = analyser !== null && playing;

  useEffect(() => {
    if (!live || !analyser) return;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const levels = new Array(BARS.length).fill(0.3);
    // Speech energy sits below ~4 kHz; spread the 14 bands over that range.
    const nyquist = analyser.context.sampleRate / 2;
    const maxBin = Math.max(
      BARS.length,
      Math.floor((4000 / nyquist) * analyser.frequencyBinCount),
    );
    const edges = Array.from({ length: BARS.length + 1 }, (_, i) =>
      Math.max(1, Math.round(Math.pow(maxBin, i / BARS.length))),
    );
    const els = rects.current;
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(bins);
      const k = SMOOTHING[toneRef.current] ?? 0.6;
      for (let b = 0; b < BARS.length; b++) {
        const band = BAND_FOR_BAR[b];
        let lo = edges[band];
        const hi = Math.max(lo + 1, edges[band + 1]);
        let sum = 0;
        for (; lo < hi; lo++) sum += bins[lo] ?? 0;
        const v = Math.pow(sum / (hi - edges[band]) / 255, 0.8);
        const target = 0.18 + 0.82 * v;
        levels[b] = levels[b] * k + target * (1 - k);
        const el = els[b];
        if (el) el.style.transform = `scaleY(${levels[b].toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      els.forEach((el) => el && (el.style.transform = ""));
    };
  }, [live, analyser]);

  const gap = (200 - 6) / (BARS.length - 1);
  const animate = !live && speaking && playing;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 60"
      width={width}
      height={height}
      className={styles.wave}
    >
      {BARS.map((mult, i) => (
        <rect
          key={i}
          ref={(el) => {
            rects.current[i] = el;
          }}
          x={(i * gap).toFixed(1)}
          y={13}
          width={6}
          height={34}
          rx={3}
          className={animate ? styles.barAnimated : styles.bar}
          style={{
            fill: tone.color,
            // Live frames already arrive at 60 fps; easing them would lag.
            transition: live ? "fill 1.6s ease-in-out" : undefined,
            animationDuration: `${(tone.speed * mult).toFixed(3)}s`,
            animationDelay: `-${DELAYS[i]}s`,
          }}
        />
      ))}
    </svg>
  );
}
