"use client";

// Locale store + string table.
//
// Deliberately not a library: this is one page with one switch, and the whole
// point of the globe control is that a Korean judge and an English-reading
// visitor see the SAME interface, not a half-translated one. A table you can
// read top to bottom makes a missing translation obvious; a lazy-loaded
// message catalogue hides it until someone flips the switch on stage.
//
// What this CANNOT translate: strings the backend supplies at runtime — the
// feedback prompt's question and options, and the calibration test's questions
// (backend/api config). Those arrive in Korean and are rendered as sent. The
// switch covers every string the frontend owns.

import { useSyncExternalStore } from "react";
import type { EmotionCategory, ShapeKind } from "@/types/emotion";

export type Locale = "ko" | "en";

const KEY = "soundshape.locale";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read(): Locale {
  try {
    return window.localStorage.getItem(KEY) === "en" ? "en" : "ko";
  } catch {
    return "ko";
  }
}

/** Korean is the default: this is a Korean competition entry. */
function readOnServer(): Locale {
  return "ko";
}

export function setLocale(next: Locale) {
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Not remembering the choice is survivable; it still applies this session.
  }
  // Keep the document in sync so screen readers switch voice and the browser
  // picks the right hyphenation and font fallbacks.
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, read, readOnServer);
}

export function useT() {
  return STRINGS[useLocale()];
}

// ── Emotion and shape names ────────────────────────────────────────────────
//
// These used to render as the raw enum — a Korean readout saying
// "감정 / resignation" and "모양 / flowing_wave" — while the legend two
// sections below already taught "체념 · Resignation". Same vocabulary, two
// spellings, on the panel judges look at longest.

export const EMOTION_NAMES: Record<EmotionCategory, Record<Locale, string>> = {
  joy: { ko: "기쁨", en: "Joy" },
  sadness: { ko: "슬픔", en: "Sadness" },
  anger: { ko: "분노", en: "Anger" },
  fear: { ko: "두려움", en: "Fear" },
  surprise: { ko: "놀람", en: "Surprise" },
  neutral: { ko: "중립", en: "Neutral" },
  sincerity: { ko: "진심", en: "Sincerity" },
  resignation: { ko: "체념", en: "Resignation" },
  sarcasm: { ko: "비꼼", en: "Sarcasm" },
};

export const SHAPE_NAMES: Record<ShapeKind, Record<Locale, string>> = {
  flowing_wave: { ko: "흐르는 파형", en: "Flowing wave" },
  soft_circle: { ko: "부드러운 곡선", en: "Soft curve" },
  drooping_ellipse: { ko: "처지는 타원", en: "Drooping ellipse" },
  jagged_star: { ko: "날카로운 봉우리", en: "Jagged peaks" },
  trembling_spikes: { ko: "떨리는 가시", en: "Trembling spikes" },
  expanding_burst: { ko: "퍼지는 파열", en: "Expanding burst" },
  simple_circle: { ko: "단순한 원", en: "Simple circle" },
};

export function emotionName(c: EmotionCategory | string, locale: Locale): string {
  return EMOTION_NAMES[c as EmotionCategory]?.[locale] ?? String(c);
}

export function shapeName(s: ShapeKind | string, locale: Locale): string {
  return SHAPE_NAMES[s as ShapeKind]?.[locale] ?? String(s);
}

// ── UI strings ─────────────────────────────────────────────────────────────

interface Strings {
  langSwitch: string;
  langOther: string;
  tagline: { lead: string; what: string; mid: string; how: string; tail: string };
  controls: {
    soundshape: string;
    captions: string;
    legend: string;
    details: string;
    rendering: string;
    hybrid: string;
    aiOnly: string;
    hybridHelp: string;
    aiOnlyHelp: string;
    unavailableHelp: string;
  };
  player: { play: string; pause: string; restart: string };
  sections: {
    source: string;
    readout: string;
    legendTitle: string;
    timeline: string;
    timelineNote: string;
    legendNote: string;
  };
  readout: {
    emotion: string;
    valence: string;
    arousal: string;
    shape: string;
    f0mean: string;
    f0range: string;
    intensity: string;
    jitter: string;
    measured: string;
    inferred: string;
    measuredHelp: string;
    inferredHelp: string;
    syntheticNote: string;
  };
  upload: {
    cta: string;
    hint: string;
    firstRun: string;
    replace: string;
    toDemo: string;
    analyzing: (pct: string) => string;
    seconds: (n: string) => string;
  };
  stage: {
    analyzingHead: (s: string) => string;
    pipeline: string;
    buffering: string;
    fieldLabel: (emotion: string) => string;
    nowPlaying: (emotion: string, reads: string) => string;
  };
  demo: {
    sourceLabel: string;
    thesis: string;
    thesisHint: string;
  };
  script: {
    summary: string;
    step1: string;
    step2: string;
    tags: string;
    play: string;
  };
  errors: { failed: string; backendHint: string };
  calibration: {
    eyebrow: string;
    title: string;
    note: string;
    start: string;
    duration: string;
    applied: string;
    appliedNote: string;
    again: string;
    reset: string;
    channels: { saturation: string; lightness: string; size: string; motion: string };
  };
  timeline: { seekLabel: string; at: (t: string) => string };
  legendReads: Record<
    "anger" | "joy" | "sadness" | "fear" | "sincerity" | "neutral",
    string
  >;
  fourTone: { title: string; hint: string };
  confidence: { label: string; help: string; low: string };
  keys: { help: string };
  footer: string;
}

const STRINGS: Record<Locale, Strings> = {
  ko: {
    langSwitch: "언어",
    langOther: "English",
    tagline: {
      lead: "자막은 ",
      what: "무엇을",
      mid: " 말했는지 전한다. SoundShape는 ",
      how: "어떻게",
      tail: " 말했는지 보여준다.",
    },
    controls: {
      soundshape: "SoundShape",
      captions: "자막",
      legend: "범례",
      details: "분석 정보",
      rendering: "렌더링",
      hybrid: "하이브리드",
      aiOnly: "AI 전용",
      hybridHelp:
        "크기·채도·움직임을 실제 목소리에서 측정합니다. 색과 모양만 AI 판단입니다.",
      aiOnlyHelp: "모든 채널을 AI의 감정 판단에서 만듭니다 (이전 방식).",
      unavailableHelp:
        "이 클립에는 측정된 운율이 없어 두 방식이 같습니다. 파일을 올리면 전환할 수 있습니다.",
    },
    player: { play: "재생", pause: "일시정지", restart: "처음부터" },
    sections: {
      source: "입력",
      readout: "이 순간의 값",
      legendTitle: "시각 언어",
      timeline: "감정 흐름",
      timelineNote: "색 = 매핑된 감정 · 너비 = 발화 길이",
      legendNote:
        "색 = 감정의 종류 · 뾰족함 = 목소리의 날카로움 · 높이 = 크기 · 떨림 = 불안정성",
    },
    readout: {
      emotion: "감정",
      valence: "정서가",
      arousal: "각성",
      shape: "모양",
      f0mean: "F0 평균",
      f0range: "F0 범위",
      intensity: "강도",
      jitter: "지터",
      measured: "측정값",
      inferred: "AI 판단",
      measuredHelp: "목소리에서 직접 측정한 값입니다 (PRAAT).",
      inferredHelp: "AI 분류기가 판단한 값입니다.",
      syntheticNote:
        "예시 장면의 참고 수치입니다 · 파일을 올리면 이 자리에 PRAAT이 실제로 측정한 값이 들어갑니다.",
    },
    upload: {
      cta: "내 파일로 시험해 보기",
      hint: "끌어다 놓거나 클릭 · WAV·MP3·MP4·MKV",
      firstRun: "첫 실행은 모델 로딩에 약 30초",
      replace: "다른 파일",
      toDemo: "예시로",
      analyzing: (pct) => `분석 중 ${pct}%`,
      seconds: (n) => `${n}초`,
    },
    stage: {
      analyzingHead: (s) => `앞부분 분석 중… ${s}초`,
      pipeline: "FFmpeg → Whisper → PRAAT → wav2vec2",
      buffering: "버퍼링…",
      fieldLabel: (emotion) => `감정 시각화: ${emotion}`,
      nowPlaying: (emotion, reads) => `지금: ${emotion} — ${reads}`,
    },
    demo: {
      sourceLabel: "예시 · “괜찮아” 네 가지 어조",
      thesis:
        "같은 “괜찮아”가 네 번. 글자는 넷 다 같고, 목소리만 다릅니다.",
      thesisHint: "타임라인의 구간을 눌러 네 어조를 비교해 보세요.",
    },
    script: {
      summary: "내 스크립트로 재생 (.srt) — 모델 해석 대신 내가 정한 자막·감정으로",
      step1: "1 · 영상 또는 오디오",
      step2: "2 · 스크립트 — 줄 앞에 [비꼼]/[진심]/[분노] 태그 가능",
      tags: "태그: 비꼼·진심·위로·분노·짜증·슬픔·체념·놀람·기쁨·공포·중립",
      play: "내 스크립트로 재생",
    },
    errors: {
      failed: "처리에 실패했습니다",
      backendHint: "백엔드가 실행 중인지 확인해 주세요 —",
    },
    calibration: {
      eyebrow: "맞춤 설정",
      title: "화면을 내 눈에 맞추기",
      note: "색·크기·움직임 중 무엇이 잘 보이는지 짧게 측정해, 표현 강도를 자동으로 조정합니다. 잘 안 보이는 채널은 더 세게, 잘 보이는 채널은 더 차분하게.",
      start: "측정 시작",
      duration: "약 2분 30초",
      applied: "내 눈에 맞춰 적용됨",
      appliedNote:
        "아래 배율로 각 채널의 표현 강도를 조정하고 있습니다. 1.00보다 크면 더 뚜렷하게, 작으면 더 은은하게 그립니다.",
      again: "다시 측정",
      reset: "기본값으로",
      channels: { saturation: "채도", lightness: "밝기", size: "크기", motion: "움직임" },
    },
    timeline: {
      seekLabel: "재생 위치",
      at: (t) => `${t} 지점`,
    },
    legendReads: {
      anger: "높고 크고 빠른 목소리 — 날카로운 봉우리",
      joy: "넓은 음역, 밝은 성조 — 부풀어 오르는 파형",
      sadness: "낮고 느린 목소리 — 길게 흐르는 파형",
      fear: "떨림(지터)이 큰 목소리 — 잘게 진동하는 파형",
      sincerity: "고르고 잡음 적은 목소리 — 완만한 곡선",
      neutral: "변화 없음 — 회색, 거의 평평",
    },
    fourTone: {
      title: "같은 “괜찮아”, 네 번",
      hint: "글자는 넷 다 같습니다. 눌러서 비교해 보세요.",
    },
    confidence: {
      label: "확신도",
      help: "분류기가 이 판단을 얼마나 확신하는지. 낮으면 화면에서도 더 흐리게 그립니다.",
      low: "확신 낮음",
    },
    keys: { help: "스페이스 = 재생·정지 · ← → = 이동" },
    footer: "SoundShape · 한국코드페어 2026",
  },

  en: {
    langSwitch: "Language",
    langOther: "한국어",
    tagline: {
      lead: "Captions tell you ",
      what: "what",
      mid: " was said. SoundShape shows you ",
      how: "how",
      tail: ".",
    },
    controls: {
      soundshape: "SoundShape",
      captions: "Captions",
      legend: "Legend",
      details: "Readout",
      rendering: "Render",
      hybrid: "Hybrid",
      aiOnly: "AI only",
      hybridHelp:
        "Size, saturation and motion are measured from the voice itself. Only colour and shape come from the classifier.",
      aiOnlyHelp:
        "Every channel is derived from the classifier's emotion vector (the earlier behaviour).",
      unavailableHelp:
        "This clip carries no measured prosody, so both modes render the same. Upload a file to compare them.",
    },
    player: { play: "Play", pause: "Pause", restart: "Restart" },
    sections: {
      source: "Source",
      readout: "This moment",
      legendTitle: "Visual language",
      timeline: "Emotion over time",
      timelineNote: "colour = mapped emotion · width = duration",
      legendNote:
        "colour = which feeling · sharpness = vocal edge · height = loudness · tremor = instability",
    },
    readout: {
      emotion: "Emotion",
      valence: "Valence",
      arousal: "Arousal",
      shape: "Shape",
      f0mean: "F0 mean",
      f0range: "F0 range",
      intensity: "Intensity",
      jitter: "Jitter",
      measured: "Measured",
      inferred: "AI inferred",
      measuredHelp: "Measured directly from the voice (PRAAT).",
      inferredHelp: "Judged by the emotion classifier.",
      syntheticNote:
        "Illustrative values for the demo scene · upload a file and these become what PRAAT actually measured.",
    },
    upload: {
      cta: "Try it with your own file",
      hint: "Drop it here or click · WAV·MP3·MP4·MKV",
      firstRun: "First run loads the models — about 30 s",
      replace: "Replace",
      toDemo: "Back to demo",
      analyzing: (pct) => `Analyzing ${pct}%`,
      seconds: (n) => `${n} s`,
    },
    stage: {
      analyzingHead: (s) => `Analyzing the opening… ${s} s`,
      pipeline: "FFmpeg → Whisper → PRAAT → wav2vec2",
      buffering: "Buffering…",
      fieldLabel: (emotion) => `Emotion visualization: ${emotion}`,
      nowPlaying: (emotion, reads) => `Now: ${emotion} — ${reads}`,
    },
    demo: {
      sourceLabel: "Demo · “괜찮아” in four tones",
      thesis:
        "The same “괜찮아”, four times. The words are identical — only the voice changes.",
      thesisHint: "Click a segment on the timeline to compare the four readings.",
    },
    script: {
      summary:
        "Play my own script (.srt) — my captions and emotions instead of the model's",
      step1: "1 · Video or audio",
      step2: "2 · Script — prefix a line with [비꼼]/[진심]/[분노] to tag it",
      tags: "Tags: 비꼼·진심·위로·분노·짜증·슬픔·체념·놀람·기쁨·공포·중립",
      play: "Play my script",
    },
    errors: {
      failed: "Processing failed",
      backendHint: "Is the backend running? —",
    },
    calibration: {
      eyebrow: "Calibration",
      title: "Tune the visuals to your eyes",
      note: "A short test of which you read most easily — colour, size or motion — then the channels are rescaled to suit you. Whatever you read least gets pushed harder; whatever you read easily is calmed down.",
      start: "Start the test",
      duration: "about 2 min 30 s",
      applied: "Tuned to your eyes",
      appliedNote:
        "Each channel is being scaled by the factor below. Above 1.00 is drawn more strongly, below it more gently.",
      again: "Test again",
      reset: "Back to default",
      channels: { saturation: "Saturation", lightness: "Lightness", size: "Size", motion: "Motion" },
    },
    timeline: {
      seekLabel: "Playback position",
      at: (t) => `at ${t}`,
    },
    legendReads: {
      anger: "high, loud, fast — needle-sharp peaks",
      joy: "wide range, bright tone — a blooming wave",
      sadness: "low and slow — long flowing swells",
      fear: "high jitter — a finely trembling wave",
      sincerity: "even, little noise — gentle curves",
      neutral: "no change — grey, nearly flat",
    },
    fourTone: {
      title: "The same “괜찮아”, four times",
      hint: "All four lines read identically. Click to compare.",
    },
    confidence: {
      label: "Confidence",
      help: "How sure the classifier is. When it is low, the field is drawn fainter too.",
      low: "low confidence",
    },
    keys: { help: "Space = play/pause · ← → = seek" },
    footer: "SoundShape · Korea Code Fair 2026",
  },
};
