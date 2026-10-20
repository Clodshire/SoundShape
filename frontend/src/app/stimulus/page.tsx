"use client";

// 실험 자극 렌더 페이지. 화면에 영상 + 자막(+ SoundShape)만 띄운다.
//
// 녹화 스크립트(`scripts/render_stimuli.py`)가 CDP 로 이 페이지를 열고 화면을
// 그대로 녹화한다. 스튜디오를 쓰지 않고 따로 만든 이유는 UI 를 숨기는 것보다
// 필요한 것만 그리는 쪽이 두 조건의 자막 위치·크기를 정확히 같게 만들기 쉽기 때문이다.
//
//   /stimulus?clip=1&ss=1   자막 + SoundShape
//   /stimulus?clip=1&ss=0   자막만
//   /stimulus?tag=분노       영상 없이 그 감정의 필드만 (보고서 도판용)
//   /stimulus?demo=1        연출 대본 — 아래 참고
//
// 감정은 질문지의 정답을 그대로 넣는다. 모델에 맡기지 않는 이유: 이 녹화분(2~3초)
// 에서는 모델이 12개 중 1개만 맞혔다. 그대로 쓰면 B 조건이 거의 틀린 감정을 보여
// 주게 되어, 재려던 것(시각 언어가 전달되는가)을 못 재게 된다.
//
// ── 연출 대본 모드 (?demo=) ───────────────────────────────────────────────
// 감정과 **확신도까지** 손으로 적어 두고 그대로 재생한다 (`public/stimuli/demo.json`).
// 한 영상 안에서 시각에 따라 감정이 바뀌는 것도 적을 수 있다.
//
// 왜 필요한가: 2~3초 녹화에서 한국어 모델의 확신도 중앙값은 38%이고, 50%를 넘긴
// 구간은 거의 전부 오답이었다 (측정: 18개 원본 → 20구간 중 50% 이상 7개, 대본
// 문장은 5개 전부 오답). 그 출력을 그대로 틀면 "자신 있게 틀린 화면"만 남는다.
//
// **여기 나오는 숫자는 모델 출력이 아니라 사람이 적은 값이다.** 화면을 설명하기
// 위한 연출이고, 모델 성능의 근거로 쓸 수 없다. 성능 숫자는 보고서의 교차검증
// 결과(영어 79.8% / 한국어 49.6%)를 쓸 것.

import { useEffect, useRef, useState } from "react";
import { createEmotionField, type EmotionFieldHandle } from "@/lib/emotionField";
import { mapEmotionToVisual } from "@/lib/mapping";
import { TONES, toneForEmotion } from "@/components/site/tones";
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

/** 연출 대본의 한 줄. `conf` 는 화면에 띄울 확신도 (0~1). */
interface Cue {
  t: number;
  text: string;
  tag: string;
  conf: number;
}

interface DemoClip {
  src: string;
  cues: Cue[];
}

const CAPTION_FONT =
  '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

export default function Stimulus() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<EmotionFieldHandle | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [showSS, setShowSS] = useState(false);

  const [tile, setTile] = useState<string | null>(null);
  const [demo, setDemo] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // ?tag=분노 — 영상 없이 그 감정의 필드만 그린다 (보고서 도판용).
    const tag = q.get("tag");
    if (tag) { setTile(tag); setShowSS(true); return; }
    // ?demo=1 — 연출 대본. 감정·확신도를 적어 둔 대로 재생한다.
    const d = q.get("demo");
    if (d) { setDemo(d); return; }
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
  if (demo) return <DemoScript id={demo} />;
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
      <Scrim />

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
      <Caption text={clip.text} />
    </div>
  );
}

/** 아래쪽 어둠. 자극과 연출 대본이 같은 값을 써야 화면이 같아 보인다. */
function Scrim() {
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: "42%",
        background:
          "linear-gradient(to top, rgba(0,0,0,.78) 0%, rgba(0,0,0,.62) 38%, rgba(0,0,0,0) 100%)",
        pointerEvents: "none",
      }}
    />
  );
}

function Caption({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute", left: 0, right: 0, bottom: "7%",
        textAlign: "center", padding: "0 6%",
        fontFamily: CAPTION_FONT,
        fontWeight: 700, fontSize: "clamp(28px, 4.4vw, 76px)", lineHeight: 1.3,
        color: "#fff", textShadow: "0 2px 14px rgba(0,0,0,.85), 0 0 4px rgba(0,0,0,.9)",
      }}
    >
      {text}
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

/**
 * 연출 대본 재생. `public/stimuli/demo.json` 에 적어 둔 감정과 확신도를
 * 영상 시각에 맞춰 그대로 보여 준다.
 *
 * 확신도는 배지에 띄우는 데서 끝나지 않고 `Emotion.confidence` 로도 넘긴다.
 * 매핑이 낮은 확신을 색 흐리게로 바꾸기 때문에, 그러지 않으면 화면이 제품과
 * 달라져 연출이 아니라 다른 프로그램이 된다.
 */
function DemoScript({ id }: { id: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<EmotionFieldHandle | null>(null);
  const [data, setData] = useState<DemoClip | null>(null);
  const [idx, setIdx] = useState(-1);

  useEffect(() => {
    fetch("/stimuli/demo.json")
      .then((r) => r.json())
      .then((all: Record<string, DemoClip>) => setData(all[id] ?? null))
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const f = createEmotionField(canvasRef.current, { transparent: true });
    fieldRef.current = f;
    const w = window as typeof window & { __stim?: Record<string, unknown> };
    if (w.__stim) w.__stim.renderer = f.renderer;
    (canvasRef.current as HTMLCanvasElement & { __ssField?: EmotionFieldHandle }).__ssField = f;
    return () => { f.destroy(); fieldRef.current = null; };
  }, [data]);

  // 재생 위치로 현재 줄을 고른다. timeupdate 는 초당 4번쯤이라 감정이 바뀌는
  // 순간이 눈에 띄게 늦는다. 녹화는 실시간 재생이라 rAF 로 따라가도 된다.
  useEffect(() => {
    if (!data) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        let i = -1;
        for (let k = 0; k < data.cues.length; k++) {
          if (v.currentTime >= data.cues[k].t) i = k; else break;
        }
        if (i !== last) { last = i; setIdx(i); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const cue = data && idx >= 0 ? data.cues[idx] : null;

  useEffect(() => {
    const f = fieldRef.current;
    if (!f || !cue) return;
    const base = TAG_TO_EMOTION[cue.tag] ?? TAG_TO_EMOTION.중립;
    f.setVisual(mapEmotionToVisual({ ...base, confidence: cue.conf }));
  }, [cue]);

  useEffect(() => {
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
  }, [data]);

  if (!data) return <div style={{ background: "#000", width: "100vw", height: "100vh" }} />;

  const tone = TONES[toneForEmotion(cue ? TAG_TO_EMOTION[cue.tag] : undefined)];

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden", margin: 0 }}>
      <style>{`nextjs-portal{display:none!important}`}</style>
      <video
        ref={videoRef}
        src={data.src}
        muted
        playsInline
        preload="auto"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
      <Scrim />

      {/* 확신도 배지 — 크롬 확장과 같은 문구·같은 자리 */}
      {cue && (
        <div
          style={{
            position: "absolute", top: "3.2%", left: "3%",
            display: "inline-flex", alignItems: "center", gap: 10,
            padding: "10px 16px", borderRadius: 12,
            background: "rgba(0,0,0,.6)", color: "#fff",
            fontFamily: CAPTION_FONT, fontWeight: 700,
            fontSize: "clamp(13px, 1.5vw, 26px)", lineHeight: 1.4,
          }}
        >
          <span
            style={{
              width: "0.62em", height: "0.62em", borderRadius: "50%",
              backgroundColor: tone.color, flex: "none",
            }}
          />
          지금: {tone.label} · 확신 {Math.round(cue.conf * 100)}%
        </div>
      )}

      <canvas
        ref={canvasRef}
        style={{
          position: "absolute", left: "19%", bottom: "15%",
          width: "62%", height: "21%", pointerEvents: "none",
        }}
      />

      <Caption text={cue?.text ?? ""} />
    </div>
  );
}
