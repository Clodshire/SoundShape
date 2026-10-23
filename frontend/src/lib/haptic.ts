// 손목 밴드 — 목소리를 그대로 따라 떤다.
//
// 처음에는 감정마다 리듬을 만들어 되풀이했다. 감정은 구분됐지만 **같은 박자가
// 계속 돌아서** 영상과 따로 노는 느낌이 났다. 말은 리듬이 아니다.
//
// 지금은 **지금 나는 소리의 크기를 그대로** 손목으로 보낸다. 말이 세질 때 세지고,
// 끊길 때 끊기고, 떨릴 때 같이 떨린다. 화면의 도형이 목소리를 따라 움직이는 것과
// 같은 값에서 나오므로, 보는 것과 느끼는 것이 어긋나지 않는다.
//
// 감정은 **전체 세기**로만 남긴다 — 분노는 묵직하게, 슬픔은 여리게. 박자를 만들지
// 않으니 되풀이되는 느낌이 없다.
//
// 펌웨어는 그대로 쓴다 (`docs/haptic_제작설명서.md` 4단계). 0~127 바이트를 받아
// 그대로 진동시키고 255 를 정지로 읽는다.
//
// 크롬·엣지에서만 되고 (Web Serial), localhost 또는 HTTPS 여야 하며, 포트 선택
// 창은 클릭 안에서 띄워야 한다. 아두이노 시리얼 모니터가 열려 있으면 포트를
// 뺏기므로 둘 중 하나만 쓸 것.

import type { EmotionCategory } from "@/types/emotion";

/** 펌웨어 상한. */
const MAX_AMP = 127;

/** 펌웨어의 정지 신호. */
const STOP_BYTE = 255;

/**
 * 감정별 전체 세기. **박자가 아니라 음량 배율이다.**
 *
 * 같은 크기로 말해도 분노는 묵직하게, 슬픔은 여리게 닿는다. 리듬을 만들면
 * 되풀이되는 느낌이 나므로, 감정은 이 한 숫자로만 남긴다.
 */
const GAIN: Record<string, number> = {
  anger: 1.0,
  sarcasm: 0.9,
  fear: 0.85,
  joy: 0.8,
  sadness: 0.55,
  neutral: 0.45,
};

/** 매핑에 있는 나머지 범주를 위 여섯 가지로 접는다 (화면의 tones.ts 와 같은 규칙). */
const FOLD: Record<string, keyof typeof GAIN> = {
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

/** 감정의 세기 배율. 확신이 낮으면 함께 낮춘다. */
export function gainFor(
  category: EmotionCategory | string | undefined,
  confidence = 1,
): number {
  const g = GAIN[FOLD[category ?? "neutral"] ?? "neutral"] ?? 0.45;
  return g * (0.6 + 0.4 * Math.max(0, Math.min(1, confidence)));
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

let port: SerialPortLike | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
/** 앞의 쓰기가 끝나기 전에 또 쓰면 밀린다 — 한 번에 하나만 보낸다. */
let busy = false;
let lastSent = -1;

/**
 * 진단용 상태. 손목에 아무 느낌이 없을 때 **어디서 끊겼는지** 보려고 둔다 —
 * 포트가 안 붙은 건지, 붙었는데 0 만 쓰고 있는 건지 겉으로는 구분이 안 된다.
 * 콘솔에서 `__ssHaptic` 으로 본다.
 */
const diag = {
  connected: false,
  lastByte: 0,
  written: 0,
  skipped: 0,
  lastError: "",
};
if (typeof window !== "undefined") {
  (window as typeof window & { __ssHaptic?: typeof diag }).__ssHaptic = diag;
}

export function haptikSupported(): boolean {
  return typeof navigator !== "undefined" && serial() !== null;
}

export function isConnected(): boolean {
  return writer !== null;
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
 * 발표 당일에도 똑같이 걸리적거린다. 첫 연결만 사람 손이 필요하다.
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
    port = null;
    writer = null;
    diag.connected = false;
    diag.lastError = String(e);
    return false;
  }
}

export async function disconnectBand(): Promise<void> {
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
  busy = false;
  lastSent = -1;
  diag.connected = false;
  try {
    await port?.close();
  } catch {
    /* 이미 닫힘 */
  }
  port = null;
}

/**
 * 지금 세기를 손목으로 보낸다. 매 프레임 불러 주면 된다 (0~1).
 *
 * 같은 값이 이어지면 보내지 않는다 — 60Hz 로 같은 바이트를 계속 밀어 넣을
 * 이유가 없고, 시리얼이 밀리면 오히려 진동이 끊긴다. 다만 **0 은 꼭 한 번은
 * 보낸다**, 안 그러면 펌웨어가 마지막 값으로 계속 떤다.
 */
export function sendAmp(level: number): void {
  if (!writer) return;
  const byte = Math.max(0, Math.min(MAX_AMP, Math.round(level * MAX_AMP)));
  if (byte === lastSent) return;
  if (busy) {
    diag.skipped += 1;
    return;
  }
  const w = writer;
  busy = true;
  lastSent = byte;
  diag.lastByte = byte;
  diag.written += 1;
  void w
    .write(new Uint8Array([byte]))
    .catch((e) => {
      diag.lastError = String(e);
    })
    .finally(() => {
      busy = false;
    });
}

/** 멈춘다. 0 을 보내고, 펌웨어의 400ms 타임아웃이 한 번 더 눌러 준다. */
export function stopBand(): void {
  lastSent = -1;
  if (!writer) return;
  const w = writer;
  busy = false;
  diag.lastByte = 0;
  void w.write(new Uint8Array([0])).catch(() => {});
}
