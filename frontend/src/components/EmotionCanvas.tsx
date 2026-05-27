"use client";

import { useEffect, useRef } from "react";
import type {
  HSLColor,
  MotionSpec,
  ShapeKind,
  VisualSpec,
} from "@/types/emotion";

interface Props {
  visual: VisualSpec;
  // Resets the per-emotion animation phase when this value changes
  // (so each new emotion draws from t=0 of its own motion cycle).
  changedAt: number;
}

export function EmotionCanvas({ visual, changedAt }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(performance.now());

  // Mutable ref so the rAF loop reads the latest visual spec without
  // having to be torn down + re-created on every prop change.
  const visualRef = useRef<VisualSpec>(visual);
  visualRef.current = visual;

  useEffect(() => {
    startRef.current = performance.now();
  }, [changedAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (now: number) => {
      const v = visualRef.current;
      const elapsed = (now - startRef.current) / 1000;
      drawScene(ctx, canvas.getBoundingClientRect(), v, elapsed);
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full rounded-2xl bg-black shadow-2xl"
    />
  );
}

// ──────────────────────────────────────────────────────────────────────
// Drawing
// ──────────────────────────────────────────────────────────────────────

function drawScene(
  ctx: CanvasRenderingContext2D,
  rect: { width: number; height: number },
  v: VisualSpec,
  t: number,
): void {
  const { width: w, height: h } = rect;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const [ox, oy, scaleMul, rot] = applyMotion(v.motion, t);

  const baseRadius = Math.min(w, h) * 0.42 * v.size * scaleMul;

  ctx.save();
  ctx.translate(cx + ox, cy + oy);
  ctx.rotate(rot);

  const fill = hslString(v.color);
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.shadowColor = fill;
  ctx.shadowBlur = 30;

  drawShape(ctx, v.shape, baseRadius, t);
  ctx.restore();
}

function applyMotion(
  m: MotionSpec,
  t: number,
): [number, number, number, number] {
  switch (m.type) {
    case "still":
      return [0, 0, 1, 0];

    case "slow_drift": {
      const ox = Math.sin(t * m.speed * 2) * 18 * m.amplitude;
      const oy = Math.cos(t * m.speed * 1.5) * 10 * m.amplitude;
      return [ox, oy, 1, 0];
    }

    case "pulse": {
      const scale = 1 + Math.sin(t * m.speed * 6) * 0.12 * m.amplitude;
      return [0, 0, scale, 0];
    }

    case "shake": {
      const f = m.speed * 24;
      const ox = (Math.sin(t * f) + Math.sin(t * f * 1.7)) * 14 * m.amplitude;
      const oy = (Math.cos(t * f * 1.3) + Math.cos(t * f * 2.1)) * 14 * m.amplitude;
      const rot = Math.sin(t * f * 0.5) * 0.18 * m.amplitude;
      return [ox, oy, 1, rot];
    }

    case "tremor": {
      const f = m.speed * 50;
      const ox = (Math.random() - 0.5) * 8 * m.amplitude;
      const oy = (Math.random() - 0.5) * 8 * m.amplitude;
      return [ox, oy, 1 + Math.sin(t * f) * 0.02, 0];
    }

    case "sink": {
      const cycle = (t * m.speed) % 4;
      const oy = Math.sin((cycle / 4) * Math.PI) * 22 * m.amplitude;
      return [0, oy, 1 - Math.abs(oy) / 400, 0];
    }
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeKind,
  r: number,
  t: number,
): void {
  switch (shape) {
    case "simple_circle":
      drawCircle(ctx, r);
      break;
    case "soft_circle":
      drawSoftCircle(ctx, r);
      break;
    case "flowing_wave":
      drawFlowingWave(ctx, r, t);
      break;
    case "drooping_ellipse":
      drawDroopingEllipse(ctx, r);
      break;
    case "jagged_star":
      drawJaggedStar(ctx, r, t);
      break;
    case "trembling_spikes":
      drawTremblingSpikes(ctx, r, t);
      break;
    case "expanding_burst":
      drawExpandingBurst(ctx, r, t);
      break;
  }
}

function drawCircle(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawSoftCircle(ctx: CanvasRenderingContext2D, r: number) {
  const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
  const fill = ctx.fillStyle as string;
  grad.addColorStop(0, fill);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlowingWave(ctx: CanvasRenderingContext2D, r: number, t: number) {
  ctx.lineWidth = Math.max(3, r * 0.05);
  ctx.lineCap = "round";
  const span = r * 2.4;
  for (let layer = 0; layer < 3; layer++) {
    ctx.globalAlpha = 0.45 + layer * 0.2;
    ctx.beginPath();
    const yOffset = (layer - 1) * r * 0.25;
    for (let x = -span / 2; x <= span / 2; x += 4) {
      const phase = t * 0.6 + layer * 0.7;
      const y = Math.sin((x / r) * 2 + phase) * r * 0.18 + yOffset;
      if (x === -span / 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawDroopingEllipse(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.ellipse(0, r * 0.15, r, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawJaggedStar(ctx: CanvasRenderingContext2D, r: number, t: number) {
  const spikes = 9;
  const inner = r * 0.42;
  const rotation = t * 0.4;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2 + rotation;
    const radius = i % 2 === 0 ? r : inner;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawTremblingSpikes(
  ctx: CanvasRenderingContext2D,
  r: number,
  t: number,
) {
  const spikes = 6;
  ctx.lineWidth = Math.max(2, r * 0.04);
  for (let i = 0; i < spikes; i++) {
    const base = (i / spikes) * Math.PI * 2;
    const tremor = Math.sin(t * 40 + i * 1.3) * 0.05;
    const angle = base + tremor;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
}

function drawExpandingBurst(
  ctx: CanvasRenderingContext2D,
  r: number,
  t: number,
) {
  const petals = 8;
  const phase = t * 1.5;
  const breathing = (Math.sin(phase) + 1) / 2;
  const outer = r * (0.75 + breathing * 0.25);
  ctx.beginPath();
  for (let i = 0; i <= petals * 24; i++) {
    const angle = (i / (petals * 24)) * Math.PI * 2;
    const local = Math.cos(angle * petals + phase) * 0.25 + 0.75;
    const rad = outer * local;
    const x = Math.cos(angle) * rad;
    const y = Math.sin(angle) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function hslString(c: HSLColor): string {
  return `hsl(${c.h} ${c.s}% ${c.l}%)`;
}
