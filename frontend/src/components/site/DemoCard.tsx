"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmotionCanvas } from "@/components/EmotionCanvas";
import { health, processFileStream, processUrlStream } from "@/lib/api";
import { DEFAULT_RENDER_MODE, mapEmotionToVisual, type RenderMode } from "@/lib/mapping";
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

  const startFile = useCallback(
    (file: File) => {
      setSource({
        kind: "file",
        url: URL.createObjectURL(file),
        name: file.name,
        isVideo: isVideoFile(file),
      });
      setStatus("업로드하는 중");
      void runStream((signal) => processFileStream(file, callbacks, { signal }));
    },
    [callbacks, runStream],
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

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStage("idle");
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
  const progress = duration > 0 ? Math.min(1, analyzedUntil / duration) : 0;

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
    return {
      ...base,
      color: { h: toneHsl.h, s: Math.max(30, base.color.s), l: toneHsl.l },
      uncertainty: conf == null ? 0 : Math.max(0, Math.min(1, 1 - conf / 0.85)),
    };
  }, [last, segments, toneHsl, renderMode]);

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
        <div className={styles.confBadge}>
          <span className={styles.confDot} style={{ backgroundColor: tone.color }} />
          지금: {tone.label}
          {conf != null && ` · 확신 ${Math.round(conf * 100)}%`}
        </div>
      )}
      <div className={styles.overlay}>
      <div className={styles.overlayLine}>
        {isSS && (
          <div className={styles.overlayWave}>
            {/* 영상에도 **실제 렌더러**를 쓴다. 예전에는 막대 14개를 CSS 로
                흔드는 장식을 띄웠는데, 그것은 분석 결과가 아니라 그림이었고
                화면에서도 토막토막 끊겨 보였다. */}
            <EmotionCanvas visual={fieldVisual} changedAt={last?.t ?? 0} transparent />
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
              ? `${Math.round(progress * 100)}% · ${analyzedUntil.toFixed(0)}초 / ${duration.toFixed(0)}초`
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
                      <EmotionCanvas visual={fieldVisual} changedAt={last?.t ?? 0} transparent />
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
                </div>
                <div className={styles.bottomRight}>
                  <div className={styles.legend}>
                    {TONE_ORDER.map((id) => (
                      <span key={id} className={styles.legendItem}>
                        <span aria-hidden="true" className={styles.legendDot} style={{ backgroundColor: TONES[id].color }} />
                        {TONES[id].label}
                      </span>
                    ))}
                  </div>
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
