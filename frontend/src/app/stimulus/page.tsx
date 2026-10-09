"use client";

// 실험 자극 렌더 페이지. 화면에 영상 + 자막(+ SoundShape)만 띄운다.
//
// 녹화 스크립트(`scripts/render_stimuli.py`)가 CDP 로 이 페이지를 열고 화면을
// 그대로 녹화한다. 스튜디오를 쓰지 않고 따로 만든 이유는 UI 를 숨기는 것보다
// 필요한 것만 그리는 쪽이 두 조건의 자막 위치·크기를 정확히 같게 만들기 쉽기 때문이다.
//
//   /stimulus?clip=1&ss=1   자막 + SoundShape
//   /stimulus?clip=1&ss=0   자막만
//
// 감정은 질문지의 정답을 그대로 넣는다. 모델에 맡기지 않는 이유: 이 녹화분(2~3초)
// 에서는 모델이 12개 중 1개만 맞혔다. 그대로 쓰면 B 조건이 거의 틀린 감정을 보여
// 주게 되어, 재려던 것(시각 언어가 전달되는가)을 못 재게 된다.

import { useEffect, useRef, useState } from "react";
import { createEmotionField, type EmotionFieldHandle } from "@/lib/emotionField";
import { mapEmotionToVisual } from "@/lib/mapping";
import type { Emotion } from "@/types/emotion";

const TAG_TO_EMOTION: Record<string, Emotion> = {
  기쁨: { category: "joy", valence: 0.6, arousal: 0.5 },
  슬픔: { category: "sadness", valence: -0.5, arousal: -0.3 },
  분노: { category: "anger", valence: -0.6, arousal: 0.7 },
  공포: { category: "fear", valence: -0.5, arousal: 0.6 },
  중립: { category: "neutral", valence: 0, arousal: 0 },
  비꼼: { category: "sarcasm", valence: -0.35, arousal: 0.15 },
};

interface Clip {
  text: string;
  tag: string;
  src: string;
}

export default function Stimulus() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<EmotionFieldHandle | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [showSS, setShowSS] = useState(false);

  const [tile, setTile] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // ?tag=분노 — 영상 없이 그 감정의 필드만 그린다 (보고서 도판용).
    const tag = q.get("tag");
    if (tag) { setTile(tag); setShowSS(true); return; }
    const id = q.get("clip") ?? "1";
    const ss = q.get("ss") !== "0";
    setShowSS(ss);
    fetch("/stimuli/clips.json")
      .then((r) => r.json())
      .then((all: Record<string, Clip>) => setClip(all[id] ?? null));
  }, []);

  // 녹화 스크립트가 상태를 알 수 있도록 window 에 걸어 둔다.
  useEffect(() => {
    const w = window as typeof window & { __stim?: Record<string, unknown> };
    w.__stim = { ready: false, ended: false, renderer: null };
  }, []);

  useEffect(() => {
    if (!clip || !showSS || !canvasRef.current) return;
    const f = createEmotionField(canvasRef.current, { transparent: true });
    fieldRef.current = f;
    f.setVisual(mapEmotionToVisual(TAG_TO_EMOTION[clip.tag] ?? TAG_TO_EMOTION.중립));
    const w = window as typeof window & { __stim?: Record<string, unknown> };
    if (w.__stim) w.__stim.renderer = f.renderer;
    // 녹화 스크립트와 점검용. WebGL 캔버스는 루프 밖에서 읽으면 비어 있어서
    // 핸들의 capture() 가 있어야 무엇이 그려졌는지 확인할 수 있다.
    (canvasRef.current as HTMLCanvasElement & { __ssField?: EmotionFieldHandle }).__ssField = f;
    return () => f.destroy();
  }, [clip, showSS]);

  useEffect(() => {
    if (!clip) return;
    const v = videoRef.current;
    if (!v) return;
    const w = window as typeof window & { __stim?: Record<string, unknown> };
    const onReady = () => { if (w.__stim) w.__stim.ready = true; };
    const onEnd = () => { if (w.__stim) w.__stim.ended = true; };
    v.addEventListener("canplaythrough", onReady);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("canplaythrough", onReady);
      v.removeEventListener("ended", onEnd);
    };
  }, [clip]);

  if (tile) return <Tile tag={tile} />;
  if (!clip) return <div style={{ background: "#000", width: "100vw", height: "100vh" }} />;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "#000",
        overflow: "hidden", margin: 0,
      }}
    >
      {/* 개발 서버 배지를 숨긴다 — 녹화 화면 왼쪽 아래에 찍힌다 */}
      <style>{`nextjs-portal{display:none!important}`}</style>
      <video
        ref={videoRef}
        src={clip.src}
        muted
        playsInline
        preload="auto"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* 아래쪽 어둠. 흰 커튼 앞에서 찍은 영상에서는 필드도 자막도 묻힌다.
          방송 자막이 쓰는 것과 같은 수법이고, 두 조건에 **똑같이** 깔아야
          '자막만' 과 '자막+SoundShape' 의 차이가 밝기 때문이 되지 않는다. */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: "42%",
          background:
            "linear-gradient(to top, rgba(0,0,0,.78) 0%, rgba(0,0,0,.62) 38%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* 감정 필드 — 자막 바로 위 띠. 두 조건에서 자막 위치가 같아야 하므로
          자막은 필드와 무관하게 늘 같은 자리에 둔다. */}
      {showSS && (
        <canvas
          ref={canvasRef}
          style={{
            // 얼굴과 자막 사이의 띠. 입을 가리면 안 된다 — 구화를 쓰는
            // 참가자가 입모양을 읽는다. 자막은 아래 7% 에 고정.
            // 가로를 62% 로 좁혀 캔버스 비율을 스튜디오(약 5:1)에 맞춘다.
            // 1920x227 처럼 지나치게 납작하면 셰이더가 그리는 형태가 작아진다.
            position: "absolute", left: "19%", bottom: "15%",
            width: "62%", height: "21%", pointerEvents: "none",
          }}
        />
      )}

      {/* 자막 — 두 조건 공통 */}
      <div
        style={{
          position: "absolute", left: 0, right: 0, bottom: "7%",
          textAlign: "center", padding: "0 6%",
          fontFamily: '"Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
          fontWeight: 700, fontSize: "clamp(28px, 4.4vw, 76px)", lineHeight: 1.3,
          color: "#fff", textShadow: "0 2px 14px rgba(0,0,0,.85), 0 0 4px rgba(0,0,0,.9)",
        }}
      >
        {clip.text}
      </div>
    </div>
  );
}

/** 감정 하나의 필드만 그리는 타일. 보고서의 "감정 매핑 엔진" 도판에 쓴다. */
function Tile({ tag }: { tag: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const f = createEmotionField(ref.current, { transparent: true });
    f.setVisual(mapEmotionToVisual(TAG_TO_EMOTION[tag] ?? TAG_TO_EMOTION.중립));
    const w = window as typeof window & { __stim?: Record<string, unknown> };
    w.__stim = { ready: true, renderer: f.renderer };
    return () => f.destroy();
  }, [tag]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "#0B0B0D",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 18,
        fontFamily: '"Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif',
      }}
    >
      {/* 개발 배지가 도판에 찍힌다 */}
      <style>{`nextjs-portal{display:none!important}`}</style>
      {/* 비율을 제품과 같은 약 5:1 로. 정사각형에 가까우면 형태가 커지면서
          가운데가 흰색으로 날아가 색상이 사라진다. */}
      <canvas ref={ref} style={{ width: "82%", height: "26%" }} />
      <div style={{ color: "#fff", fontSize: 54, fontWeight: 800, letterSpacing: "-0.02em" }}>
        {tag}
      </div>
    </div>
  );
}
