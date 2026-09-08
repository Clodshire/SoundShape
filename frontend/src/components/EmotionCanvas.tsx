"use client";

import { useEffect, useRef } from "react";
import { createEmotionField, type EmotionFieldHandle } from "@/lib/emotionField";
import type { VisualSpec } from "@/types/emotion";

interface Props {
  visual: VisualSpec;
  // Bumped when the active segment changes — seeds a transition flash.
  changedAt: number;
  // When true, output per-pixel alpha so the field glows over a <video>.
  transparent?: boolean;
}

/**
 * Thin React wrapper around the framework-agnostic emotion-field renderer
 * (`@/lib/emotionField`). The same renderer powers the Chrome-extension overlay,
 * so visuals are identical everywhere. See emotionField.ts for the shader.
 */
export function EmotionCanvas({ visual, changedAt, transparent = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<EmotionFieldHandle | null>(null);

  // Create the field once per transparency mode.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const field = createEmotionField(canvas, { transparent });
    field.setVisual(visual);
    fieldRef.current = field;
    // Hang the handle off the DOM node so the report-figure capture script
    // (frontend/scripts/capture_figures.js, run from the browser console) can
    // reach field.capture(). Reading the canvas from outside the render loop
    // returns an empty buffer, so there is no way to do this from the DOM alone.
    (canvas as HTMLCanvasElement & { __ssField?: EmotionFieldHandle }).__ssField = field;
    return () => {
      field.destroy();
      fieldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transparent]);

  // Push the latest visual every render.
  useEffect(() => {
    fieldRef.current?.setVisual(visual);
  }, [visual]);

  // Flash on segment/emotion change.
  useEffect(() => {
    fieldRef.current?.pulse();
  }, [changedAt]);

  return (
    <canvas
      ref={canvasRef}
      className={transparent ? "h-full w-full" : "h-full w-full rounded-2xl bg-black"}
    />
  );
}
