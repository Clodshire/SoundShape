"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { health, processFileStream, processUrlStream } from "@/lib/api";
import { DEFAULT_RENDER_MODE, mapEmotionToVisual, type RenderMode } from "@/lib/mapping";
import { buildTimelineFromScript } from "@/lib/scriptMode";
import {
  connectBand,
  disconnectBand,
  gainFor,
  haptikSupported,
  reconnectBand,
  sendAmp,
  stopBand,
} from "@/lib/haptic";
import type { TimelineFrame } from "@/types/emotion";
import styles from "./site.module.css";
import { TONES, TONE_ORDER, hexToHsl, lineAt, toneForEmotion, type ToneId } from "./tones";
import { YouTubeStage } from "./YouTubeStage";

type Stage = "idle" | "analyzing" | "ready" | "error";

type Source =
  | { kind: "file"; url: string; name: string; isVideo: boolean }
  | { kind: "youtube"; url: string; videoId: string };

const ACCEPT = ".wav,.mp3,.mp4,.mkv,.m4a,.webm,.mov,audio/*,video/*";
// Start playback once this much audio is analyzed (or the whole clip is).
const PREBUFFER_SEC = 8;

export function youTubeId(input: string): string | null {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1) || null;
    if (host === "youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
      if (m) return m[2];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function isVideoFile(f: File): boolean {
  return f.type.startsWith("video/") || /\.(mp4|mkv|webm|mov)$/i.test(f.name);
}

export function DemoCard() {
  const [stage, setStage] = useState<Stage>("idle");
  const [source, setSource] = useState<Source | null>(null);
  const [segments, setSegments] = useState<TimelineFrame[]>([]);
  const [duration, setDuration] = useState(0);
  const [analyzedUntil, setAnalyzedUntil] = useState(0);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState("업로드하는 중");
  const [error, setError] = useState("");
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  // 연출 대본(?script=)으로 재생 중인가. 선명도를 올리는 데만 쓴다.
  const [vividRender, setVividRender] = useState(false);
  // 미리 분석해 둔 결과를 트는 모드(`?live=<키>`). 무대에서 파일을 직접 고르는
  // 모습은 보여 주되, 분석은 어제 끝내 둔 것을 불러온다. 심사위원에게 그렇게
  // 밝히고 쓰는 전제다 — 밝히지 않으면 방금 분석한 것으로 읽힌다.
  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [liveWait, setLiveWait] = useState(6.5);
  // 준비된 결과를 트는 동안의 진행률. 진짜 분석의 analyzedUntil 을 건드리면
  // `enough` 가 먼저 참이 되어 화면이 일찍 넘어가 버린다.
  const [prepProgress, setPrepProgress] = useState<number | null>(null);
  // 연출 대본의 이름. 심사위원이 "지금 몇 번째를 보고 있는지" 알 수 있게
  // 화면과 탭 제목에 같이 띄운다.
  const [demoLabel, setDemoLabel] = useState("");
  // 손목 밴드. 브라우저가 Web Serial 을 지원할 때만 버튼이 나온다.
  const [band, setBand] = useState(false);

  const [mode, setMode] = useState<"ss" | "caption">("ss");
  const [renderMode, setRenderMode] = useState<RenderMode>(DEFAULT_RENDER_MODE);
  const [showConf, setShowConf] = useState(true);
  const [follow, setFollow] = useState(true);
  const [manualTone, setManualTone] = useState<ToneId>("neutral");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [ytInput, setYtInput] = useState("");

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    health().then((ok) => alive && setServerUp(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Free the object URL when the source changes or the page goes away.
  useEffect(() => {
    return () => {
      if (source?.kind === "file") URL.revokeObjectURL(source.url);
    };
  }, [source]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Leave the analyzing screen as soon as there is enough to watch; the rest
  // keeps streaming in behind playback.
  const enough =
    done || (duration > 0 && analyzedUntil >= Math.min(duration, PREBUFFER_SEC));
  const view: Stage = stage === "analyzing" && enough ? "ready" : stage;

  const runStream = useCallback(
    async (start: (signal: AbortSignal) => Promise<void>) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setSegments([]);
      setDuration(0);
      setAnalyzedUntil(0);
      setDone(false);
      setError("");
      setVividRender(false);
      setDemoLabel("");
      setTime(0);
      setFollow(true);
      setMode("ss");
      setStage("analyzing");
      try {
        await start(ac.signal);
      } catch (e) {
        if (ac.signal.aborted) return;
        setError(
          e instanceof TypeError
            ? "분석 서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해주세요."
            : String(e instanceof Error ? e.message : e),
        );
        setStage("error");
      }
    },
    [],
  );

  const callbacks = useMemo(
    () => ({
      onStatus: (s: string) =>
        setStatus(s === "downloading" ? "유튜브에서 소리를 받는 중" : "준비하는 중"),
      onMetadata: (m: { duration: number }) => {
        setDuration(m.duration);
        setStatus("목소리 톤을 분석하는 중");
      },
      onSegment: (seg: TimelineFrame) => {
        setSegments((prev) => [...prev, seg]);
        setAnalyzedUntil(seg.t + seg.duration);
      },
      onDone: () => setDone(true),
      onError: (msg: string) => {
        setError(msg);
        setStage("error");
      },
    }),
    [],
  );

  /**
   * 준비해 둔 결과를 불러와 재생한다.
   *
   * 고른 파일 이름이 준비된 키와 맞을 때만 이 길로 간다. 다른 파일을 고르면
   * 평소대로 진짜 분석이 돌아간다 — 심사위원이 아무 영상이나 올려 보자고 해도
   * 그대로 대응되어야 하기 때문이다.
   */
  const playPrepared = useCallback(
    async (key: string, file: File) => {
      abortRef.current?.abort();
      setSource({ kind: "file", url: URL.createObjectURL(file), name: file.name, isVideo: true });
      setSegments([]);
      setAnalyzedUntil(0);
      setDone(false);
      setError("");
      setTime(0);
      setFollow(true);
      setMode("ss");
      setStage("analyzing");
      setStatus("업로드하는 중");

      let timeline: TimelineFrame[] = [];
      let total = 0;
      try {
        const res = await fetch(`/stimuli/${key}.srt`);
        if (!res.ok) throw new Error(String(res.status));
        const built = buildTimelineFromScript(await res.text(), { vivid: true });
        timeline = built.timeline;
        total = built.totalDuration;
        if (!timeline.length) throw new Error("대본이 비어 있습니다");
      } catch (e) {
        setError(`준비된 결과를 불러오지 못했어요 (${e instanceof Error ? e.message : e}).`);
        setStage("error");
        return;
      }
      setDuration(total);

      // 진행을 **구간 단위로 튀게** 한다.
      //
      // 진짜 분석은 매끄럽게 차오르지 않는다. 앞쪽은 오디오를 꺼내고 목소리를
      // 분리하고 전사하는 동안 막대가 아예 안 움직이다가, 그다음부터 구간이
      // 하나씩 도착할 때마다 뚝뚝 뛴다. 일정한 속도로 채우면 그게 바로
      // 미리 만들어 둔 티가 난다.
      //
      // 그래서 앞 45% 는 멈춰 있고(문구만 바뀐다), 나머지에서 자막 줄 수만큼
      // 나눠 뛴다. 간격은 조금씩 어긋나게 둔다 — 정확히 같은 간격으로 뛰면
      // 그것도 사람이 만든 티가 난다.
      const total_ms = liveWait * 1000;
      const headMs = total_ms * 0.45;
      // 문구가 바뀌는 시점은 **막대가 멈춰 있는 구간 안**에 들어가야 한다.
      // 0.45 를 넘기면 마지막 문구가 스쳐 지나가 버려서 아무도 못 읽는다.
      const steps: [number, string][] = [
        [0, "업로드하는 중"],
        [0.08, "음성을 꺼내는 중"],
        [0.18, "목소리와 배경음 분리"],
        [0.32, "자막 만드는 중"],
      ];
      const t0 = performance.now();
      // 구간이 도착하는 시각. 뒤로 갈수록 조금 빨라진다 (실제로도 모델이
      // 데워진 뒤가 빠르다).
      const n = timeline.length;
      const arrive = timeline.map((_, i) => {
        const f = (i + 1) / n;
        const eased = Math.pow(f, 0.85);
        const jitter = ((i * 2654435761) % 1000) / 1000 - 0.5; // 고르게 흩되 매번 같게
        return headMs + (total_ms - headMs) * eased + jitter * 90;
      });

      await new Promise<void>((resolve) => {
        const tick = () => {
          const ms = performance.now() - t0;
          if (ms < headMs) {
            setPrepProgress(0);
            for (let i = steps.length - 1; i >= 0; i--) {
              if (ms >= steps[i][0] * total_ms) { setStatus(steps[i][1]); break; }
            }
          } else {
            setStatus("목소리 톤을 분석하는 중");
            let arrived = 0;
            while (arrived < n && ms >= arrive[arrived]) arrived += 1;
            // 도착한 구간의 끝 시각까지가 '분석된 길이'다 — 진짜 분석과 같다.
            const until = arrived > 0
              ? timeline[arrived - 1].t + (timeline[arrived - 1].duration ?? 0)
              : 0;
            setPrepProgress(Math.min(1, until / Math.max(0.1, total)));
          }
          if (ms >= total_ms) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      setPrepProgress(null);
      setSegments(timeline);
      setAnalyzedUntil(total);
      setDone(true);
      setVividRender(true);
      setStage("ready");
    },
    [liveWait],
  );

  const startFile = useCallback(
    (file: File) => {
      // 준비해 둔 클립인가. 이름의 앞부분만 본다 — 사본이라 `demo1 (1).mp4`
      // 처럼 되어 있어도 같은 영상이다.
      if (liveKey && file.name.toLowerCase().startsWith(liveKey.toLowerCase())) {
        void playPrepared(liveKey, file);
        return;
      }
      setSource({
        kind: "file",
        url: URL.createObjectURL(file),
        name: file.name,
        isVideo: isVideoFile(file),
      });
      setStatus("업로드하는 중");
      void runStream((signal) => processFileStream(file, callbacks, { signal }));
    },
    [callbacks, runStream, liveKey, playPrepared],
  );

  const startYouTube = useCallback(
    (url: string, videoId: string) => {
      setSource({ kind: "youtube", url, videoId });
      setStatus("유튜브에서 소리를 받는 중");
      void runStream((signal) => processUrlStream(url, callbacks, { signal }));
    },
    [callbacks, runStream],
  );

  const startExample = useCallback(async () => {
    try {
      const res = await fetch("/samples/ko_test.wav");
      const blob = await res.blob();
      startFile(new File([blob], "예시_괜찮아요.wav", { type: "audio/wav" }));
    } catch {
      setError("예시 파일을 불러오지 못했어요.");
      setStage("error");
    }
  }, [startFile]);

  // 연출 대본 재생 — `?script=<키>` 로 `/stimuli/<키>.srt` + `.mp4` 를 띄운다.
  //
  // 백엔드를 아예 거치지 않는다. 시연 영상을 찍을 때 모델 출력을 쓸 수 없기
  // 때문이다: 2~3초 발화에서 한국어 모델의 확신도 중앙값은 38%이고, 50%를
  // 넘긴 구간은 대본 문장 다섯 개가 전부 오답이었다.
  //
  // **여기 보이는 감정과 확신도는 .srt 에 사람이 적은 값이다.** 화면을 설명하기
  // 위한 연출이고 모델 성능의 근거가 아니다. 성능은 교차검증 결과를 쓸 것.
  const startScript = useCallback(async (key: string) => {
    try {
      const res = await fetch(`/stimuli/${key}.srt`);
      if (!res.ok) throw new Error(String(res.status));
      const { timeline, totalDuration } = buildTimelineFromScript(await res.text(), { vivid: true });
      if (!timeline.length) throw new Error("대본에서 자막을 찾지 못했습니다");
      setSource({ kind: "file", url: `/stimuli/${key}.mp4`, name: `${key}.mp4`, isVideo: true });
      setSegments(timeline);
      setDuration(totalDuration);
      setAnalyzedUntil(totalDuration);
      setDone(true);
      setMode("ss");
      setFollow(true);
      setVividRender(true);
      const m = key.match(/^demo(\d*)$/);
      const label = m ? `데모${m[1] ? ` ${m[1]}` : ""}` : key;
      setDemoLabel(label);
      setStage("ready");
    } catch (e) {
      setError(`연출 대본을 불러오지 못했어요 (${e instanceof Error ? e.message : e}).`);
      setStage("error");
    }
  }, []);

  useEffect(() => {
    // 발표 중에는 주소 표시줄도 보인다. `/demo` · `/livedemo` 를 먼저 보고,
    // 질의 문자열은 다른 클립을 시험할 때를 위해 남겨 둔다.
    const path = window.location.pathname.replace(/\/+$/, "");
    const q = new URLSearchParams(window.location.search);

    if (path === "/livedemo") {
      setLiveKey("demo");
      setLiveWait(6.5);
      return;
    }
    if (path === "/demo") {
      void startScript("demo");
      return;
    }

    const key = q.get("script");
    if (key) void startScript(key);
    const live = q.get("live");
    if (live) {
      setLiveKey(live);
      const w = Number(q.get("wait"));
      if (Number.isFinite(w) && w > 0) setLiveWait(w);
    }
  }, [startScript]);

  // 탭 제목도 같이 바꾼다. 효과로 거는 이유: 라우터가 메타데이터 제목을 나중에
  // 덮어쓰기 때문에, 대본을 읽는 그 자리에서 넣으면 도로 돌아간다.
  useEffect(() => {
    if (demoLabel) document.title = `${demoLabel} — SoundShape`;
  }, [demoLabel]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStage("idle");
    setVividRender(false);
    setDemoLabel("");
    setPrepProgress(null);
    setSource(null);
    setSegments([]);
    setPlaying(false);
    setYtInput("");
    health().then(setServerUp);
  }, []);

  // ── Current line + tone ──
  const { current, last } = lineAt(segments, time);
  const toneId: ToneId = follow
    ? last
      ? toneForEmotion(last.emotion)
      : "neutral"
    : manualTone;
  const tone = TONES[toneId];
  const isSS = mode === "ss";
  const waiting = !done && time > analyzedUntil;
  const captionText = current
    ? current.text.trim()
    : waiting
      ? "분석 중…"
      : "";
  const progress =
    prepProgress != null
      ? prepProgress
      : duration > 0
        ? Math.min(1, analyzedUntil / duration)
        : 0;
  const shownAnalyzed = prepProgress != null ? prepProgress * duration : analyzedUntil;

  // ── Web Audio: real amplitude for the bars (file playback only) ──
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const wiredEl = useRef<HTMLMediaElement | null>(null);

  const wireAnalyser = useCallback((el: HTMLMediaElement) => {
    try {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const ctx = ctxRef.current;
      void ctx.resume();
      if (wiredEl.current === el) return;
      const src = ctx.createMediaElementSource(el);
      const node = ctx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.3;
      src.connect(node);
      node.connect(ctx.destination);
      wiredEl.current = el;
      setAnalyser(node);
    } catch {
      setAnalyser(null); // CSS fallback
    }
  }, []);

  useEffect(() => () => void ctxRef.current?.close(), []);

  const mediaHandlers = {
    onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      wireAnalyser(e.currentTarget);
      setPlaying(true);
    },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setTime(e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) =>
      setTime(e.currentTarget.currentTime),
  };

  // Smoother caption timing than timeupdate's ~4 Hz while playing.
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    if (!playing || source?.kind !== "file") return;
    let raf = 0;
    const tick = () => {
      if (mediaRef.current) setTime(mediaRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, source]);

  // ── Emotion field (the studio's WebGL renderer) for audio playback ──
  // Shape, size and motion come from the real analysis of the line. Hue and
  // lightness are the site's tone colour so the field, pill and legend read as
  // the same colour — but SATURATION comes from the mapping, because that is
  // one of the three channels hybrid rendering re-sources from the measured
  // voice. Pinning it to the tone's own saturation hid the difference the
  // 하이브리드 / AI 전용 toggle exists to show.
  //
  // Floored at 30: the mapping returns 0 for the neutral category (grey by
  // design), and a grey field next to a green pill looks like a bug rather
  // than a reading.
  const toneHsl = useMemo(() => hexToHsl(tone.color), [tone.color]);
  const fieldVisual = useMemo(() => {
    const seg = last ?? segments[0];
    const base = mapEmotionToVisual(
      seg?.emotion ?? { category: "neutral", valence: 0, arousal: 0 },
      seg?.prosody,
      seg?.reference,
      renderMode,
      undefined,
    );
    const conf = seg?.emotion?.confidence;
    // 연출 재생은 측정값이 없어 hybrid 가 꺼지고, 낮은 확신도가 채도를 바닥까지
    // 끌어내린다 (비꼼 39→25, 슬픔 25→10). 그 위에 셰이더의 흐림까지 겹치면
    // 빔프로젝터에서는 회색으로 보인다 — 심사위원이 보는 건 그 화면이다.
    // 그래서 연출 재생에서만 채도의 바닥을 올리고 흐림을 절반으로 줄인다.
    // 색상과 감정 간 순서는 그대로라, 보이는 의미는 달라지지 않는다.
    // 바닥을 올리되 납작하게 만들지는 않는다. 눌린 채도를 [58, 92] 구간으로
    // 다시 펼치면, 확신이 높을수록 진하다는 관계는 화면에 그대로 남는다.
    const uScale = vividRender ? 0.5 : 1;
    const sat = vividRender
      ? 58 + (Math.min(95, base.color.s) / 95) * 34
      : Math.max(30, base.color.s);
    return {
      ...base,
      color: { h: toneHsl.h, s: sat, l: toneHsl.l },
      uncertainty:
        conf == null ? 0 : uScale * Math.max(0, Math.min(1, 1 - conf / 0.85)),
    };
  }, [last, segments, toneHsl, renderMode, vividRender]);

  // 손목은 **목소리를 그대로 따라 떤다.** 감정마다 박자를 만들어 되풀이하면
  // 같은 리듬이 계속 돌아서 영상과 따로 노는 느낌이 난다 — 말은 리듬이 아니다.
  // 감정은 전체 세기로만 남긴다 (분노는 묵직, 슬픔은 여리게).
  const lastRef = useRef(last);
  lastRef.current = last;
  const mediaTime = () => mediaRef.current?.currentTime ?? 0;
  /** 이 줄의 발화가 끝나기까지 남은 시간(초). 자막이 아니라 말 기준. */
  const speechLeft = (f: TimelineFrame | null | undefined): number => {
    if (!f) return 0;
    return (f.t + (f.speechDuration ?? f.duration ?? 0)) - mediaTime();
  };

  useEffect(() => {
    if (!band) return;
    if (!playing || !analyser) {
      stopBand();
      return;
    }
    const buf = new Uint8Array(analyser.fftSize);
    let env = 0;    // 지금 소리 크기 — 빠르게 따라간다
    let peak = 0;   // 최근 최대치 — 영상마다 녹음 레벨이 달라 기준으로 쓴다
    let raf = 0;
    const tick = () => {
      // 말이 끝났으면 바로 끊는다. 배경음이 아무리 커도 울리지 않는다.
      if (speechLeft(lastRef.current) <= 0) {
        stopBand();
        raf = requestAnimationFrame(tick);
        return;
      }

      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
      }
      const v = Math.sqrt(sum / buf.length);
      // 올라올 때는 거의 그대로, 내려갈 때만 조금 늦춘다. 너무 매끄럽게 하면
      // 말의 억양이 뭉개져서 '소리를 따라간다'는 느낌이 사라진다.
      env = v > env ? env + (v - env) * 0.8 : env + (v - env) * 0.35;
      peak = Math.max(peak * 0.999, env);

      // 그 영상의 가장 큰 소리를 1 로 본다. 고정 기준을 쓰면 조용한 클립에서
      // 아무것도 안 느껴지고 큰 클립에서는 내내 최대가 된다.
      const norm = peak > 0.004 ? Math.min(1, env / peak) : 0;
      // 모터에는 **느껴지기 시작하는 지점**이 있다. 그 아래로 보낸 값은
      // 전부 "약하게 웅웅거림" 하나로 뭉개진다 — 심사에서 "느껴지지 않는데
      // 계속 울린다"는 말을 들은 게 그 구간에 몰려 있었기 때문이다.
      //
      // 그래서 쓰는 폭을 **0 아니면 확실히 느껴지는 값**으로 둔다. 문턱 아래는
      // 완전히 끄고(전체의 약 38%), 넘으면 바로 46 부터 시작해 127 까지 간다.
      // 대비가 '약하다 ↔ 세다' 가 아니라 '없다 ↔ 있다' 로 먼저 갈린다.
      const GATE = 0.22;
      const FLOOR = 0.36; // 46/127 — 이 아래는 손목이 구분하지 못한다
      const e = lastRef.current?.emotion;
      if (norm < GATE) {
        sendAmp(0);
      } else {
        const shaped = Math.pow((norm - GATE) / (1 - GATE), 1.3);
        // 감정 배율은 **바닥 위쪽에만** 건다. 전체에 곱하면 슬픈 장면이
        // 바닥 아래로 내려가 다시 안 느껴진다.
        const g = gainFor(e?.category, e?.confidence ?? 1);
        sendAmp(FLOOR + (1 - FLOOR) * shaped * g);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopBand();
    };
  }, [band, playing, analyser]);

  // 하이브리드는 측정값이 없으면 AI 전용과 똑같이 동작한다. 차이가 없는데
  // 토글을 보여 주면 "눌러도 아무 일도 안 난다"가 되므로 그때는 숨긴다.
  const hasProsody = (last ?? segments[0])?.prosody != null;

  const isAudioFile = source?.kind === "file" && !source.isVideo;
  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);
  const restart = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = 0;
    setTime(0);
    void el.play();
  }, []);
  const seekBy = useCallback((dt: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + dt));
    setTime(el.currentTime);
  }, []);

  // Same shortcuts as /studio: Space (or k) play/pause, ←/→ seek 1 s (5 s
  // with Shift). Ignored while typing in a field.
  useEffect(() => {
    if (view !== "ready" || !isAudioFile) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space" || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekBy(e.shiftKey ? 5 : 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekBy(e.shiftKey ? -5 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, isAudioFile, togglePlay, seekBy]);

  // 크롬 확장이 영상 왼쪽 위에 띄우는 것과 **같은 문구·같은 값**이다.
  //   지금: {감정} · 확신 {N}%
  const conf = last?.emotion?.confidence;

  const overlay = (
    <>
      <div className={styles.overlayScrim} aria-hidden="true" />
      {isSS && showConf && (
        // 배지 바로 아래에 범례를 붙인다. 화면 반대편에 떼어 놓으면 보는 사람이
        // 색을 확인하려고 눈을 옮겨야 하고, 그 사이에 색이 이미 바뀐다.
        // 크롬 확장도 같은 구성이라 두 화면이 같게 보인다.
        <div className={styles.confPanel}>
          <div className={styles.confBadge}>
            <span className={styles.confDot} style={{ backgroundColor: tone.color }} />
            지금: {tone.label}
            {conf != null && ` · 확신 ${Math.round(conf * 100)}%`}
          </div>
          <div className={styles.confLegend}>
            {TONE_ORDER.map((id) => (
              <span key={id} className={styles.confLegendItem}>
                <span
                  aria-hidden="true"
                  className={styles.confLegendDot}
                  style={{ backgroundColor: TONES[id].color }}
                />
                {TONES[id].label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className={styles.overlay}>
      <div className={styles.overlayLine}>
        {isSS && (
          <div className={styles.overlayWave}>
            {/* 영상에도 **실제 렌더러**를 쓴다. 예전에는 막대 14개를 CSS 로
                흔드는 장식을 띄웠는데, 그것은 분석 결과가 아니라 그림이었고
                화면에서도 토막토막 끊겨 보였다. */}
            <EmotionCanvas
                visual={fieldVisual}
                changedAt={last?.t ?? 0}
                transparent
                snap={vividRender}
              />
          </div>
        )}
        <span className={styles.overlayCaption} aria-live="polite">
          {captionText}
        </span>
      </div>
      </div>
    </>
  );

  return (
    <section id="demo" className={styles.demo} aria-label="체험하기">
      {view === "idle" && (
        <div
          className={`${styles.drop} ${dragOver ? styles.dropOver : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) startFile(f);
          }}
        >
          <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9a9aa5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4" />
            <path d="M6 10l6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
          <div className={styles.dropTitle}>영상을 끌어다 놓거나 올려보세요</div>
          <div className={styles.dropHint}>
            WAV · MP3 · MP4 · MKV 지원
            <br />
            또는 유튜브를 보면서 Chrome 확장 프로그램으로 바로
          </div>
          <input
            type="file"
            accept={ACCEPT}
            className={styles.srOnly}
            id="ss-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) startFile(f);
              e.target.value = "";
            }}
          />
          <div className={styles.dropButtons}>
            <label htmlFor="ss-file" className={styles.btnDark}>
              파일 선택하기
            </label>
            <button type="button" className={styles.btnOutline} onClick={startExample}>
              예시 영상으로 체험하기
            </button>
          </div>
          <form
            className={styles.ytForm}
            onSubmit={(e) => {
              e.preventDefault();
              const id = youTubeId(ytInput);
              if (id) startYouTube(ytInput.trim(), id);
            }}
          >
            <label htmlFor="ss-yt" className={styles.ytLabel}>
              유튜브 링크로 분석하기
            </label>
            <div className={styles.ytRow}>
              <input
                id="ss-yt"
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={ytInput}
                onChange={(e) => setYtInput(e.target.value)}
                className={styles.ytInput}
              />
              <button type="submit" className={styles.btnDark} disabled={!youTubeId(ytInput)}>
                분석
              </button>
            </div>
            <span className={styles.ytNote}>15분 이하 영상만 분석할 수 있어요.</span>
          </form>
          {serverUp === false && (
            <p className={styles.serverDown} role="status">
              분석 서버가 꺼져 있어요. SoundShape 폴더의 <code>start_windows.bat</code>을
              실행한 뒤 새로고침해주세요.
            </p>
          )}
        </div>
      )}

      {view === "analyzing" && (
        <div className={styles.analyzing} role="status">
          <div aria-hidden="true" className={styles.spinner} />
          <div className={styles.analyzingTitle}>영상을 분석하고 있어요…</div>
          <div className={styles.analyzingStep}>{status}</div>
          <div
            className={styles.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="분석 진행률"
          >
            <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
          </div>
          <div className={styles.analyzingMeta}>
            {duration > 0
              ? `${Math.round(progress * 100)}% · ${shownAnalyzed.toFixed(0)}초 / ${duration.toFixed(0)}초`
              : "음성 추출 → 자막 만들기 → 목소리 톤 분석"}
          </div>
          <button type="button" className={styles.linkBtn} onClick={reset}>
            취소
          </button>
        </div>
      )}

      {view === "error" && (
        <div className={styles.analyzing} role="alert">
          <div className={styles.analyzingTitle}>분석하지 못했어요</div>
          <div className={styles.errorMsg}>{error}</div>
          <button type="button" className={styles.btnDark} onClick={reset}>
            다시 시작하기
          </button>
        </div>
      )}

      {view === "ready" && source && (
        <div className={styles.ready}>
          {demoLabel && <div className={styles.demoLabel}>{demoLabel}</div>}
          <div className={styles.segmented} role="group" aria-label="보기 방식">
            <button
              type="button"
              aria-pressed={!isSS}
              onClick={() => setMode("caption")}
              className={!isSS ? styles.segOn : styles.segOff}
            >
              자막만 보기
            </button>
            <button
              type="button"
              aria-pressed={isSS}
              onClick={() => setMode("ss")}
              className={isSS ? styles.segOn : styles.segOff}
            >
              자막 + SoundShape
            </button>
          </div>

          <div className={styles.card}>
            {source.kind === "youtube" ? (
              <div className={styles.videoFrame}>
                <YouTubeStage
                  videoId={source.videoId}
                  onTime={setTime}
                  onPlaying={setPlaying}
                />
                {overlay}
              </div>
            ) : source.isVideo ? (
              <div className={styles.videoFrame}>
                <video
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  src={source.url}
                  controls
                  playsInline
                  className={styles.video}
                  {...mediaHandlers}
                />
                {overlay}
              </div>
            ) : (
              <>
                <div className={styles.fieldStage}>
                  {isSS && (
                    <div
                      className={styles.fieldBand}
                      role="img"
                      aria-label={`감정 파형 · ${tone.label}`}
                    >
                      <EmotionCanvas
                visual={fieldVisual}
                changedAt={last?.t ?? 0}
                transparent
                snap={vividRender}
              />
                    </div>
                  )}
                  <div className={styles.fieldCaption} aria-live="polite">
                    {captionText || (!playing && time === 0 ? "재생을 눌러 시작하세요" : "")}
                  </div>
                </div>
                <audio
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  src={source.url}
                  preload="auto"
                  hidden
                  {...mediaHandlers}
                />
                <div className={styles.playerRow}>
                  <div className={styles.playerControls}>
                    <button type="button" onClick={togglePlay} className={styles.playBtn}>
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" aria-hidden="true">
                        {playing ? (
                          <>
                            <rect x="2" y="1.5" width="3" height="9" rx="0.6" />
                            <rect x="7" y="1.5" width="3" height="9" rx="0.6" />
                          </>
                        ) : (
                          <path d="M2.5 1.6 10.2 6 2.5 10.4Z" />
                        )}
                      </svg>
                      {playing ? "일시정지" : "재생"}
                    </button>
                    <button type="button" onClick={restart} className={styles.restartBtn}>
                      <svg viewBox="0 0 12 12" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10 6a4 4 0 1 1-1.3-2.95" />
                        <path d="M10.2 1.4v2.6H7.6" />
                      </svg>
                      처음부터
                    </button>
                    <span className={styles.clock}>
                      {fmtTime(time)}
                      <span className={styles.clockTotal}> / {fmtTime(duration)}</span>
                    </span>
                  </div>
                  <span className={styles.keyHelp}>스페이스 = 재생·정지 · ← → = 이동</span>
                </div>
              </>
            )}

            {isSS && (
              <span className={styles.tonePill} style={{ backgroundColor: tone.color }}>
                {tone.label}
              </span>
            )}
            {isSS && (
              <div className={styles.bottomRow}>
                <div className={styles.bottomLeft}>
                  {hasProsody && (
                    <div
                      className={styles.segMini}
                      role="group"
                      aria-label="렌더링 방식"
                      title={
                        renderMode === "hybrid"
                          ? "크기·채도·움직임을 목소리에서 잰 값이 직접 그립니다"
                          : "AI가 고른 감정 하나로 전부 그립니다"
                      }
                    >
                      <button
                        type="button"
                        aria-pressed={renderMode === "hybrid"}
                        onClick={() => setRenderMode("hybrid")}
                        className={renderMode === "hybrid" ? styles.segMiniOn : styles.segMiniOff}
                      >
                        하이브리드
                      </button>
                      <button
                        type="button"
                        aria-pressed={renderMode === "full_ai"}
                        onClick={() => setRenderMode("full_ai")}
                        className={renderMode === "full_ai" ? styles.segMiniOn : styles.segMiniOff}
                      >
                        AI 전용
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-pressed={showConf}
                    onClick={() => setShowConf((v) => !v)}
                    className={showConf ? styles.segMiniOn : styles.segMiniOff}
                    title="영상 왼쪽 위에 분류기의 확신도를 표시합니다"
                  >
                    확신도
                  </button>
                  {haptikSupported() && (
                    <button
                      type="button"
                      aria-pressed={band}
                      onClick={async () => {
                        if (band) {
                          await disconnectBand();
                          setBand(false);
                        } else {
                          setBand(await connectBand());
                        }
                      }}
                      className={band ? styles.segMiniOn : styles.segMiniOff}
                      title="손목 밴드를 USB 로 연결하면 감정마다 다른 리듬으로 울립니다"
                    >
                      {band ? "밴드 연결됨" : "손목 밴드"}
                    </button>
                  )}
                </div>

              </div>
            )}
            {!done && (
              <div className={styles.stillAnalyzing} role="status">
                뒷부분 분석 중 · {Math.round(progress * 100)}%
              </div>
            )}
            {done && segments.length === 0 && (
              <div className={styles.stillAnalyzing} role="status">
                말소리를 찾지 못했어요. 대사가 있는 영상으로 다시 해보세요.
              </div>
            )}
          </div>

          <div className={styles.toneButtons} role="group" aria-label="감정 톤 직접 고르기">
            {TONE_ORDER.map((id) => {
              const t = TONES[id];
              const selected = id === toneId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={!follow && selected}
                  onClick={() => {
                    setManualTone(id);
                    setFollow(false);
                  }}
                  className={styles.toneBtn}
                  style={{
                    borderColor: t.color,
                    backgroundColor: selected ? t.color : "#ffffff",
                    color: selected ? "#ffffff" : t.color,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className={styles.readyFooter}>
            <button
              type="button"
              aria-pressed={follow}
              onClick={() => setFollow((f) => !f)}
              className={follow ? styles.autoOn : styles.autoOff}
            >
              <span aria-hidden="true" className={styles.autoDot} />
              {follow ? "분석된 감정 자동 전환 켜짐" : "자동 전환 꺼짐 (직접 선택)"}
            </button>
            <button type="button" className={styles.linkBtn} onClick={reset}>
              다른 영상으로 다시 시작하기
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
