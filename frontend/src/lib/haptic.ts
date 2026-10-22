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
const PATTERNS: Record<string, Step[]> = {
  // 짧고 단단하게 세 번. 유일하게 세 번 치는 감정이고 가장 세다.
  anger: [[127, 55], [0, 65], [127, 55], [0, 65], [127, 60]],

  // 두 번, 뒤가 더 크게. 분노보다 적게 치고 약하고 둥글다.
  joy: [[72, 60], [0, 70], [106, 65]],

  // 세게 한 번 → **긴 뜸** → 약하게 한 번. 그 뜸이 비꼼이다.
  sarcasm: [[127, 80], [0, 290], [40, 80]],

  // 끊기지 않고 잘게 떤다. 때리는 순간이 없는 두 감정 중 하나.
  fear: Array.from({ length: 30 }, (_, i): Step =>
    i % 2 === 0 ? [70, 30] : [20, 30],
  ),

  // 아주 느리게 밀려왔다 빠진다. 때리는 순간이 한 번도 없다.
  sadness: [
    [8, 100], [20, 100], [34, 110], [46, 120], [52, 140],
    [52, 240],
    [46, 130], [34, 120], [22, 110], [12, 110], [4, 100],
  ],

  // 한 번, 아주 약하게. 있었다는 것만 알린다.
  neutral: [[30, 110]],
};

/**
 * 한 바퀴 뒤 쉬는 시간.
 *
 * 세기보다 **사이의 간격**이 먼저 구분된다. 손목은 "얼마나 센가"보다 "얼마나 자주
 * 오는가"를 훨씬 잘 가른다. 그래서 주기를 0.8초에서 2.4초까지 세 배로 벌려 놓았고,
 * 전체적으로 넉넉히 쉬게 했다 — 촘촘하면 전부 한 덩어리로 뭉개진다.
 */
const REST_MS: Record<string, number> = {
  anger: 480,     // 주기 0.78초
  joy: 700,       // 주기 0.90초
  sarcasm: 700,   // 주기 1.15초
  fear: 500,      // 주기 1.40초
  neutral: 1300,  // 주기 1.41초
  sadness: 900,   // 주기 2.28초
};

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
    return true;
  } catch {
    // 사용자가 창을 닫았거나 포트를 이미 누가 쓰고 있다 (시리얼 모니터).
    port = null;
    writer = null;
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
    return true;
  } catch {
    // 이미 열려 있거나 다른 프로그램이 쓰고 있다 (시리얼 모니터).
    port = null;
    writer = null;
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
  let i = 0;
  const w = writer;
  timer = setInterval(() => {
    if (!writer || writer !== w) return stop();
    const v = i < frames.length ? frames[i] : 0;
    i += 1;
    void w.write(new Uint8Array([Math.round(v * level)])).catch(() => stop());
    // 마지막 0 까지 보내고 멈춘다. 이후에는 펌웨어의 400ms 타임아웃이
    // 한 번 더 0 으로 눌러 주므로, 연결이 끊겨도 계속 울지 않는다.
    if (i > frames.length) stop();
  }, FRAME_MS);
}
