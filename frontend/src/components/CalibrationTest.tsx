"use client";

// The calibration test screen.
//
// Runs a sequence of channel-isolated trials, records each answer with its
// response time, and posts the completed run to the backend, which scores it
// and returns per-channel weights.
//
// Deliberately plain: one stimulus area, one question, one row of buttons, a
// progress count. Anything decorative here is a confound — the participant is
// being asked what they can see, so the screen must not help them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createEmotionField, type EmotionFieldHandle } from "@/lib/emotionField";
import {
  buildCrossover,
  buildTrials,
  type CrossoverTrial,
  type Trial,
} from "@/lib/calibrationTrials";
import { saveWeights } from "@/lib/calibrationStore";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

interface Config {
  enabled: boolean;
  channels: Record<string, { label: string }>;
  trials: {
    discrimination_per_channel: number;
    semantic_per_channel: number;
    crossover_pairs: number;
  };
  emotions: string[];
  questions: Record<string, string>;
  min_response_ms: number;
}

interface Answer {
  kind: string;
  channel: string;
  correct: boolean;
  expected: string;
  answer: string;
  response_ms: number;
}

const EMOTION_LABEL: Record<string, string> = {
  joy: "기쁨",
  sadness: "슬픔",
  anger: "분노",
  fear: "불안",
  sarcasm: "비꼼",
  neutral: "중립",
};

type Visual = Parameters<EmotionFieldHandle["setVisual"]>[0];

/**
 * One WebGL glyph, mounted once for the whole test.
 *
 * Two details that are load-bearing:
 *
 * The canvas must NOT be remounted per trial. Each mount takes a WebGL
 * context, browsers cap how many can exist, and a 20-trial run would churn
 * through forty of them — after a handful every stimulus silently drops to the
 * Canvas-2D fallback and the test stops measuring what it renders. So the
 * canvas persists and only its `visual` changes.
 *
 * The canvas is absolutely positioned inside a fixed box rather than being a
 * flex item. When WebGL does fail, createEmotionField inserts a replacement
 * canvas as a SIBLING (see emotionField.ts) which copies this className — as a
 * flex item that would widen the row and push the layout out of the dialog; as
 * an absolute fill it lands exactly on top instead.
 */
function Stimulus({
  visual,
  hidden,
  onRenderer,
}: {
  visual: Visual;
  hidden?: boolean;
  onRenderer?: (kind: EmotionFieldHandle["renderer"]) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<EmotionFieldHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const h = createEmotionField(ref.current, { transparent: true });
    handle.current = h;
    onRenderer?.(h.renderer);
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    // onRenderer is a stable setter from the parent; re-running this effect
    // would take a fresh WebGL context, which is the thing to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.setVisual(visual);
  }, [visual]);

  return (
    <div
      className={[
        "relative h-44 w-44 shrink-0 overflow-hidden rounded-xl bg-black/40",
        hidden ? "invisible" : "",
      ].join(" ")}
    >
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

/** A stimulus that is present in the DOM but shows nothing. */
const BLANK: Visual = {
  shape: "simple_circle",
  color: { h: 0, s: 0, l: 0 },
  size: 0.01,
  motion: { type: "still", amplitude: 0, speed: 0 },
};

export function CalibrationTest({
  onClose,
  research = false,
}: {
  onClose: () => void;
  /** Adds the crossover block — the part that tests whether personalisation works. */
  research?: boolean;
}) {
  const [config, setConfig] = useState<Config | null>(null);
  const [trials, setTrials] = useState<Trial[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  // Phase 2 of a research run: same emotions, half rendered with the default
  // weights and half with this participant's, interleaved and unlabelled.
  const [crossover, setCrossover] = useState<CrossoverTrial[] | null>(null);
  const [crossIndex, setCrossIndex] = useState(0);
  const crossAnswers = useRef<
    { condition: string; correct: boolean; response_ms: number }[]
  >([]);
  const pendingTrials = useRef<Answer[]>([]);
  const [group, setGroup] = useState("");
  const [started, setStarted] = useState(false);
  // Set if any stimulus had to fall back. The 2D fallback draws a coloured
  // circle and nothing else — no shape, no motion — so half the trials would
  // be blank. Recording answers to blank stimuli would not just be useless,
  // it would look like evidence that shape and motion are unreadable.
  const [degraded, setDegraded] = useState(false);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    fetch(`${API_BASE}/calibration/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Config | null) => c?.enabled && setConfig(c))
      .catch(() => setConfig(null));
  }, []);

  const begin = useCallback(() => {
    if (!config) return;
    setTrials(
      buildTrials({
        emotions: config.emotions,
        discriminationPerChannel: config.trials.discrimination_per_channel,
        semanticPerChannel: config.trials.semantic_per_channel,
      }),
    );
    setStarted(true);
    shownAt.current = Date.now();
  }, [config]);

  const post = useCallback(
    async (
      all: Answer[],
      cross: typeof crossAnswers.current | null,
      store = true,
    ) => {
      const body = new FormData();
      body.append("trials", JSON.stringify(all));
      body.append("mode", cross ? "full" : "short");
      body.append("store", String(store));
      if (cross) body.append("crossover", JSON.stringify(cross));
      if (group.trim()) body.append("participant_group", group.trim());
      const res = await fetch(`${API_BASE}/calibration/session`, {
        method: "POST",
        body,
      });
      return (await res.json()).weights ?? {};
    },
    [group],
  );

  const submit = useCallback(
    async (all: Answer[]) => {
      pendingTrials.current = all;
      let w: Record<string, number> = {};
      try {
        // A research run scores now but files later, once the crossover block
        // is answered — otherwise one participant would be filed twice.
        w = await post(all, null, !research);
      } catch {
        setResult({}); // the participant is finished either way
        return;
      }
      saveWeights(w);
      if (!research || !config) {
        setResult(w);
        return;
      }
      // Weights exist now, so the crossover block can be rendered with them.
      setCrossover(
        buildCrossover(config.emotions, w, config.trials.crossover_pairs),
      );
      shownAt.current = Date.now();
    },
    [post, research, config],
  );

  const answerCrossover = useCallback(
    (value: string) => {
      if (!crossover) return;
      const t = crossover[crossIndex];
      crossAnswers.current.push({
        condition: t.condition,
        correct: value === t.expected,
        response_ms: Date.now() - shownAt.current,
      });
      if (crossIndex + 1 >= crossover.length) {
        void post(pendingTrials.current, crossAnswers.current)
          .then((w) => setResult(w))
          .catch(() => setResult({}));
        setCrossover(null);
      } else {
        setCrossIndex(crossIndex + 1);
        shownAt.current = Date.now();
      }
    },
    [crossover, crossIndex, post],
  );

  const answer = useCallback(
    (value: string) => {
      if (!trials) return;
      const t = trials[index];
      const next = [
        ...answers,
        {
          kind: t.kind,
          channel: t.channel,
          correct: value === t.expected,
          expected: t.expected,
          answer: value,
          response_ms: Date.now() - shownAt.current,
        },
      ];
      setAnswers(next);
      if (index + 1 >= trials.length) void submit(next);
      else {
        setIndex(index + 1);
        shownAt.current = Date.now();
      }
    },
    [answers, index, trials, submit],
  );

  const trial = trials && index < trials.length ? trials[index] : null;
  const options = useMemo(() => {
    if (!trial || !config) return [];
    if (trial.question === "discrimination") {
      return [
        { value: "same", label: config.questions.discrimination_same },
        { value: "different", label: config.questions.discrimination_diff },
      ];
    }
    if (trial.question === "intensity") {
      return [
        { value: "left", label: config.questions.intensity_left },
        { value: "right", label: config.questions.intensity_right },
      ];
    }
    return (trial.options ?? []).map((e) => ({
      value: e,
      label: EMOTION_LABEL[e] ?? e,
    }));
  }, [trial, config]);

  if (!config) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm text-white/60">
          백엔드에 연결할 수 없어 검사를 시작할 수 없습니다. 서버가 켜져 있는지
          확인해 주세요.
        </p>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell onClose={onClose}>
        <h2 className="text-lg font-semibold">검사 완료 — 고맙습니다</h2>
        <p className="mt-2 text-sm text-white/60">
          응답이 저장되었습니다. 이 결과로 시각 표현이 조정됩니다.
        </p>
        <dl className="mt-4 space-y-1 text-sm">
          {Object.entries(result).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-white/10 py-1">
              <dt className="text-white/65">{k}</dt>
              <dd className={v > 1 ? "text-emerald-400" : v < 1 ? "text-amber-400" : ""}>
                ×{v}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 h-10 w-full rounded-full bg-white text-sm font-medium text-black"
        >
          닫기
        </button>
      </Shell>
    );
  }

  if (!started) {
    return (
      <Shell onClose={onClose}>
        <h2 className="text-lg font-semibold">시각 표현 맞춤 설정</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          화면에 나오는 표현을 보고 {research ? "40" : "20"}번 답해 주세요. 약{" "}
          {research ? "5" : "2"}분 걸립니다.
          <br />
          <strong className="text-white/80">정답을 맞히는 시험이 아닙니다.</strong>{" "}
          어떻게 보이는지가 사람마다 달라서, 그 차이를 알아보려는 것입니다.
          <br />
          모르겠으면 짐작으로 고르셔도 됩니다.
        </p>
        <label className="mt-5 block text-xs text-white/60">
          참가자 구분 (선택 — 예: 가족, 친구, 학급)
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-white/15 bg-transparent px-3 text-sm text-white"
          />
        </label>
        <button
          type="button"
          onClick={begin}
          className="mt-5 h-10 w-full rounded-full bg-white text-sm font-medium text-black"
        >
          시작하기
        </button>
      </Shell>
    );
  }

  if (crossover) {
    const ct = crossover[crossIndex];
    return (
      <Shell onClose={onClose}>
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>
            2단계 · {crossIndex + 1} / {crossover.length}
          </span>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-white/60 transition-all"
              style={{ width: `${((crossIndex + 1) / crossover.length) * 100}%` }}
            />
          </div>
        </div>
        <div className="mt-5 flex justify-center">
          <Stimulus visual={ct.stimulus} />
        </div>
        <p className="mt-5 text-center text-sm font-medium">
          {config.questions.category}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {ct.options.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => answerCrossover(e)}
              className="h-10 rounded-lg border border-white/15 text-sm text-white/85 transition hover:bg-white/10"
            >
              {EMOTION_LABEL[e] ?? e}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => answerCrossover("__unsure__")}
          className="mt-2 h-9 w-full text-xs text-white/60 transition hover:text-white/60"
        >
          {config.questions.unsure}
        </button>
      </Shell>
    );
  }

  if (!trial) return null;

  if (degraded) {
    return (
      <Shell onClose={onClose}>
        <h2 className="text-lg font-semibold">검사를 진행할 수 없습니다</h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          이 브라우저에서 그래픽 가속(WebGL)을 쓸 수 없어, 모양과 움직임이
          화면에 표시되지 않습니다. 그 상태로 답을 받으면{" "}
          <strong className="text-white/85">
            보이지 않는 것을 못 읽었다고 잘못 기록
          </strong>
          되므로 중단했습니다.
        </p>
        <p className="mt-3 text-xs text-white/60">
          다른 탭을 닫거나 브라우저를 새로 켠 뒤 다시 시도해 주세요. 그래픽
          컨텍스트가 부족할 때 주로 발생합니다.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 h-10 w-full rounded-full bg-white text-sm font-medium text-black"
        >
          닫기
        </button>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <div className="flex items-center justify-between text-xs text-white/60">
        <span>
          {index + 1} / {trials!.length}
        </span>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-white/60 transition-all"
            style={{ width: `${((index + 1) / trials!.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Two fixed slots. A single-stimulus trial blanks the second rather
          than unmounting it, so no context is created or destroyed mid-test. */}
      <div className="mt-5 flex justify-center gap-3">
        <Stimulus
          visual={trial.stimuli[0]}
          onRenderer={(k) => k !== "webgl" && setDegraded(true)}
        />
        <Stimulus
          visual={trial.stimuli[1] ?? BLANK}
          hidden={trial.stimuli.length < 2}
          onRenderer={(k) => k !== "webgl" && setDegraded(true)}
        />
      </div>

      <p className="mt-5 text-center text-sm font-medium">
        {trial.question === "discrimination"
          ? config.questions.discrimination
          : trial.question === "intensity"
            ? config.questions.intensity
            : config.questions.category}
      </p>

      <div
        className={[
          "mt-4 grid gap-2",
          options.length > 2 ? "grid-cols-3" : "grid-cols-2",
        ].join(" ")}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => answer(o.value)}
            className="h-10 rounded-lg border border-white/15 text-sm text-white/85 transition hover:bg-white/10"
          >
            {o.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => answer("__unsure__")}
        className="mt-2 h-9 w-full text-xs text-white/60 transition hover:text-white/60"
      >
        {config.questions.unsure}
      </button>
    </Shell>
  );
}

function Shell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // This dialog is deliberately dark while the rest of the app is light, and
  // its colours are written out rather than taken from the theme tokens.
  //
  // It is a measurement instrument: it asks a participant what they can see in
  // a stimulus rendered by the same shader as the stage, and what they can see
  // depends on the ground that stimulus sits on. Restyling it later — even a
  // tasteful restyle — would mean two participants answered different
  // questions, and /study compares answers across people. Hard-coded colours
  // here are the point: they cannot drift when the palette does.
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 text-white">
      <div className="relative w-full max-w-md rounded-2xl border border-white/15 bg-zinc-950 p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-4 top-4 text-white/60 transition hover:text-white"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
