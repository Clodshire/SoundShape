// 손목 밴드 — 감정마다 다른 리듬으로 울린다.
//
// 왜 리듬인가: 밴드가 보낼 수 있는 건 세기 하나뿐이다. 화면은 색·모양·움직임
// 세 채널로 여섯 감정을 구분하지만, 세기 하나로는 못 한다 — 분노와 기쁨은 둘 다
// 각성도가 높아서 똑같이 세게 울리고, 눈을 감으면 구분이 안 된다. 그래서 세기를
// **시간으로 펼친다.** 몇 번 치는지, 얼마나 날카롭게 들어오는지, 얼마나 오래
// 끄는지는 손목이 쉽게 가른다.
//
// 펌웨어는 그대로 쓴다. `docs/haptic_제작설명서.md` 의 스케치는 0~127 바이트를
// 받아 그대로 진동시키고 255 를 정지로 읽는다. 패턴은 그 바이트를 20ms 간격으로
// 흘려보내는 것뿐이라, 보드를 다시 구울 필요가 없다.
//
// 크롬·엣지에서만 되고 (Web Serial), localhost 또는 HTTPS 여야 하며, 포트 선택
// 창은 클릭 안에서 띄워야 한다. 아두이노 시리얼 모니터가 열려 있으면 포트를
// 뺏기므로 둘 중 하나만 쓸 것.

import type { EmotionCategory } from "@/types/emotion";

/** 한 프레임의 길이. 10ms = 100Hz — 리듬이 양자화로 뭉개지지 않을 만큼 촘촘하다. */
const FRAME_MS = 10;

/** 펌웨어 상한. 넘겨 보내면 펌웨어가 잘라내지만 여기서도 막는다. */
const MAX_AMP = 127;

/** 펌웨어가 값이 끊겼다고 보고 멈추는 시간(400ms)보다 넉넉히 짧게 유지한다. */
const STOP_BYTE = 255;

type Step = [amp: number, ms: number];

/**
 * 감정별 리듬 — 한 번 도는 분량.
 *
 * 구분의 축은 **치는 횟수**와 **들어오는 모양**이다. 세기만 다르게 하면 결국
 * 같은 느낌이라, 세기는 보조로만 쓴다.
 *
 * 줄이 끝날 때까지 이 한 바퀴를 `REST` 만큼 쉬며 되풀이한다. 처음에는 한 번만
 * 쳤는데, 손목에 남는 게 전환 순간의 깜빡임뿐이라 **지금 무슨 감정인지**가 아니라
 * **방금 뭔가 바뀌었다**만 전달됐다. 화면의 도형은 그 줄 내내 떠 있으므로 손목도
 * 그래야 한다.
 */
// ── 리듬은 운율에서 나온다 ────────────────────────────────────────────────
//
// 패턴을 보기 좋게 고른 게 아니다. 화면이 감정을 색·모양·움직임으로 옮기듯,
// 손목은 **그 감정의 운율 특징을 시간으로** 옮긴다. 규칙은 셋이다.
//
//   각성도  → 박과 박 사이 (흥분할수록 촘촘하게)
//   말 속도 → 한 번에 치는 횟수 (빠른 말일수록 여러 번)
//   떨림    → 때리는가, 이어지는가 (jitter·shimmer 가 높으면 떤다)
//
// 그래서 "분노는 왜 세 번인가"에 답이 있다 — 분노는 말이 빠르고 어택이 날카롭다.
// "슬픔은 왜 느린가" 도 마찬가지다 — 말이 느리고 음높이 폭이 좁다.

/**
 * 각성도(-1~1)에서 **한 바퀴 전체 길이**를 구한다. 흥분할수록 자주 온다.
 *
 * 쉬는 시간이 아니라 주기를 각성도에 묶어야 한다. 쉼으로 잡으면 패턴 몸통
 * 길이가 제각각이라 주기가 흐트러지고, "템포가 각성도를 따른다"는 말이
 * 화면에서 사실이 아니게 된다.
 */
function periodFor(arousal: number): number {
  return Math.round(1000 * (1.5 - 0.8 * arousal));
}

/**
 * 감정별 한 바퀴.
 *
 * 각 줄 끝의 주석이 그 모양을 고른 **운율 근거**다. 근거를 댈 수 없는 모양은
 * 쓰지 않는다 — 심사에서 "왜 이 패턴이냐"는 질문이 반드시 온다.
 */
const PATTERNS: Record<string, Step[]> = {
  // 각성 0.7 · **세기 평균이 여섯 중 가장 크다** → 전부 최대로, 길게 때린다.
  // 약한 박이 하나도 없는 유일한 감정이다. 타격 길이도 가장 길게 둬서
  // (LRA 는 짧게 치면 다 돌기 전에 꺼진다) 실제로 가장 세게 닿는다.
  anger: [[127, 75], [0, 50], [127, 75], [0, 50], [127, 85]],

  // 각성 0.6 · jitter·shimmer 가 가장 높다(목소리가 떤다) → 끊기지 않는 잔떨림.
  // 여섯 중 유일하게 '때리지 않는' 쪽이라 바로 구분된다.
  fear: Array.from({ length: 24 }, (_, i): Step =>
    i % 2 === 0 ? [74, 32] : [10, 32],
  ),

  // 각성 0.5 · 음높이 폭이 넓고 끝이 올라간다 → 두 번, 뒤가 더 크게.
  joy: [[52, 60], [0, 65], [115, 70]],

  // 각성 0.15 · **세기가 평범하거나 오히려 눌려 있다** — 비꼼은 소리를 키워서
  // 하는 말이 아니라 말끝을 끌어내리며 하는 말이다. 그래서 분노의 절반 세기로,
  // 길게 비운 뒤 스치듯 한 번 더. 분노와 헷갈리지 않는 지점이 여기다.
  sarcasm: [[58, 85], [0, 300], [16, 85]],

  // 각성 0 · 음높이 폭이 좁고 세기가 중간 → 한 번, 약하게. 있었다는 것만.
  neutral: [[30, 110]],

  // 각성 -0.3 · 말이 가장 느리고 어택이 없다(밀려왔다 빠진다) → 느린 부풂.
  sadness: [
    [4, 110], [14, 110], [28, 120], [44, 130], [54, 150],
    [54, 230],
    [46, 140], [34, 130], [22, 120], [10, 110], [3, 100],
  ],
};

/** 각 감정의 각성도. 화면 매핑(scriptMode 의 TAG_TO_EMOTION)과 같은 값이다. */
const AROUSAL: Record<string, number> = {
  anger: 0.7,
  fear: 0.6,
  joy: 0.5,
  sarcasm: 0.15,
  neutral: 0,
  sadness: -0.3,
};

/** 몸통 길이(ms). 패턴 표에서 그대로 더한 값. */
function bodyMs(key: string): number {
  return PATTERNS[key].reduce((a, [, ms]) => a + ms, 0);
}

/**
 * 박과 박 사이 = 주기 − 몸통. 주기는 각성도가 정하므로, 몸통이 긴 감정일수록
 * 쉼이 짧아진다 — 슬픔은 느리게 부풀다 바로 또 부푼다(쉼 없이 이어지는 느낌),
 * 감정 없음은 한 번 톡 치고 1.4초를 비운다.
 */
const REST_MS: Record<string, number> = Object.fromEntries(
  Object.keys(AROUSAL).map((k) => [
    k,
    Math.max(150, periodFor(AROUSAL[k]) - bodyMs(k)),
  ]),
) as Record<string, number>;

/** 한 줄이 아무리 길어도 여기까지만 울린다. 그 뒤로는 손목이 무뎌진다. */
const MAX_PLAY_MS = 7000;

/** 매핑에 있는 나머지 범주를 위 여섯 가지로 접는다 (화면의 tones.ts 와 같은 규칙). */
const FOLD: Record<string, keyof typeof PATTERNS> = {
  anger: "anger",
  disgust: "anger",
  joy: "joy",
  surprise: "joy",
  sincerity: "joy",
  sadness: "sadness",
  resignation: "sadness",
  fear: "fear",
  sarcasm: "sarcasm",
  neutral: "neutral",
};

/**
 * 패턴을 프레임 배열로 편다. 하드웨어 없이도 검사할 수 있도록 따로 뺐다.
 *
 * `totalMs` 를 주면 그 길이가 찰 때까지 한 바퀴를 되풀이한다 (쉼 포함). 안 주면
 * 한 바퀴만 돈다.
 *
 * 확신도는 세기만 줄인다 — 리듬까지 흐리면 어떤 감정인지조차 알 수 없게 된다.
 * 바닥을 0.55 로 둬서, 확신이 0 이어도 손목에는 느껴진다.
 */
export function patternFrames(
  category: EmotionCategory | string,
  confidence = 1,
  totalMs?: number,
): number[] {
  const key = FOLD[category] ?? "neutral";
  const gain = 0.55 + 0.45 * Math.max(0, Math.min(1, confidence));
  const cycle: number[] = [];
  for (const [amp, ms] of PATTERNS[key]) {
    const v = Math.max(0, Math.min(MAX_AMP, Math.round(amp * gain)));
    for (let i = 0; i < Math.max(1, Math.round(ms / FRAME_MS)); i++) cycle.push(v);
  }
  if (totalMs == null) return cycle;

  const rest = Math.round(REST_MS[key] / FRAME_MS);
  const want = Math.round(Math.min(totalMs, MAX_PLAY_MS) / FRAME_MS);
  const frames: number[] = [];
  while (frames.length < want) {
    frames.push(...cycle);
    if (frames.length < want) for (let i = 0; i < rest; i++) frames.push(0);
  }
  // 줄이 끝나면 바로 멈춘다 — 다음 줄의 리듬과 겹치면 둘 다 뭉개진다.
  return frames.slice(0, want);
}

// ── 연결 ────────────────────────────────────────────────────────────────

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  /** 전에 허락한 포트들. 한 번 고르고 나면 다시 묻지 않아도 된다. */
  getPorts(): Promise<SerialPortLike[]>;
}

function serial(): SerialLike | null {
  const n = navigator as Navigator & { serial?: SerialLike };
  return n.serial ?? null;
}

/**
 * 지금 들리는 목소리의 크기 (0~1). 리듬에 곱해진다.
 *
 * 리듬은 **추론**(어떤 감정인가)이고 이 값은 **측정**(지금 실제로 소리가 나는가)
 * 이다. 둘을 곱하면 말이 끊긴 자리에서는 손목도 같이 조용해져서, 진동이 영상과
 * 따로 노는 느낌이 사라진다. 화면 쪽에서 크기·채도를 측정값에서 가져오는 것과
 * 같은 생각이다.
 */
let level = 1;

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 진단용 상태. 손목에 아무 느낌이 없을 때 **어디서 끊겼는지** 보려고 둔다 —
 * 포트가 안 붙은 건지, 붙었는데 문턱이 안 열린 건지, 열렸는데 0 만 쓰고 있는 건지
 * 겉으로는 구분이 안 된다. 콘솔에서 `__ssHaptic` 으로 본다.
 */
const diag = {
  connected: false,
  level: 1,
  lastPattern: "",
  framesWritten: 0,
  lastByte: 0,
  lastError: "",
};
if (typeof window !== "undefined") {
  (window as typeof window & { __ssHaptic?: typeof diag }).__ssHaptic = diag;
}

/** 이 브라우저에서 밴드를 쓸 수 있는가 (크롬·엣지 + localhost/HTTPS). */
export function haptikSupported(): boolean {
  return typeof navigator !== "undefined" && serial() !== null;
}

export function isConnected(): boolean {
  return writer !== null;
}

/** 재생 중 매 프레임 불러 준다. 소리가 없으면 0 에 가까워진다. */
export function setLevel(v: number): void {
  level = Math.max(0, Math.min(1, v));
  diag.level = level;
}

/** 일시정지·정지. 울리던 것을 그 자리에서 끊고 0 을 보낸다. */
export function stopBand(): void {
  stop();
  level = 1;
  if (writer) void writer.write(new Uint8Array([0])).catch(() => {});
}

/** 반드시 클릭 핸들러 안에서 부를 것 — 포트 선택 창이 제스처를 요구한다. */
export async function connectBand(): Promise<boolean> {
  const s = serial();
  if (!s) return false;
  try {
    const p = await s.requestPort();
    await p.open({ baudRate: 115200 });
    if (!p.writable) return false;
    port = p;
    writer = p.writable.getWriter();
    diag.connected = true;
    diag.lastError = "";
    return true;
  } catch (e) {
    // 사용자가 창을 닫았거나 포트를 이미 누가 쓰고 있다 (시리얼 모니터).
    port = null;
    writer = null;
    diag.connected = false;
    diag.lastError = String(e);
    return false;
  }
}

/**
 * 전에 허락한 포트가 있으면 묻지 않고 바로 붙는다.
 *
 * 새로고침할 때마다 버튼을 누르고 포트를 다시 고르는 건, 리듬을 다듬을 때도
 * 발표 당일에도 똑같이 걸리적거린다. 크롬은 한 번 허락한 포트를 기억하므로
 * 두 번째부터는 조용히 이어 붙일 수 있다. 첫 연결만 사람 손이 필요하다.
 */
export async function reconnectBand(): Promise<boolean> {
  const s = serial();
  if (!s || writer) return writer !== null;
  try {
    const [p] = await s.getPorts();
    if (!p) return false;
    await p.open({ baudRate: 115200 });
    if (!p.writable) return false;
    port = p;
    writer = p.writable.getWriter();
    diag.connected = true;
    diag.lastError = "";
    return true;
  } catch (e) {
    // 이미 열려 있거나 다른 프로그램이 쓰고 있다 (시리얼 모니터).
    port = null;
    writer = null;
    diag.connected = false;
    diag.lastError = String(e);
    return false;
  }
}

export async function disconnectBand(): Promise<void> {
  stop();
  if (writer) {
    try {
      await writer.write(new Uint8Array([STOP_BYTE]));
    } catch {
      /* 이미 끊김 */
    }
    try {
      writer.releaseLock();
    } catch {
      /* 이미 풀림 */
    }
  }
  writer = null;
  diag.connected = false;
  try {
    await port?.close();
  } catch {
    /* 이미 닫힘 */
  }
  port = null;
}

function stop(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * 한 감정의 리듬을 재생한다. `durationMs` 를 주면 그 줄이 끝날 때까지 되풀이한다.
 * 재생 중에 다시 부르면 **앞의 것을 끊고** 새로 시작한다 — 대사가 빠르게 이어질 때
 * 진동이 겹쳐 뭉개지면 안 된다.
 */
export function playEmotion(
  category: EmotionCategory | string,
  confidence = 1,
  durationMs?: number,
): void {
  if (!writer) return;
  stop();
  const frames = patternFrames(category, confidence, durationMs);
  diag.lastPattern = `${category} ${Math.round(confidence * 100)}% · ${frames.length}프레임`;
  let i = 0;
  const w = writer;
  timer = setInterval(() => {
    if (!writer || writer !== w) return stop();
    const v = i < frames.length ? frames[i] : 0;
    i += 1;
    const byte = Math.round(v * level);
    diag.framesWritten += 1;
    diag.lastByte = byte;
    void w.write(new Uint8Array([byte])).catch((e) => {
      diag.lastError = String(e);
      stop();
    });
    // 마지막 0 까지 보내고 멈춘다. 이후에는 펌웨어의 400ms 타임아웃이
    // 한 번 더 0 으로 눌러 주므로, 연결이 끊겨도 계속 울지 않는다.
    if (i > frames.length) stop();
  }, FRAME_MS);
}
