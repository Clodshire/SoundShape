"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FeedbackConfig,
  setConsent,
  submitFeedback,
} from "@/lib/feedbackClient";

interface Props {
  feedbackId: string;
  config: FeedbackConfig;
  /** Ask for permission before the first prompt instead of showing it. */
  needsConsent: boolean;
  onClose: () => void;
  onConsentDecided: (granted: boolean) => void;
}

/**
 * The corner card that asks how an uncertain moment felt.
 *
 * Two rules shape this component:
 *
 * 1. **It must never interrupt.** Not a modal, never pauses playback, and it
 *    leaves on its own. Ignoring it is a valid response.
 * 2. **The countdown is visible and pausable.** A bar drains over
 *    `display_seconds`; hovering pauses it. The same CSS animation both draws
 *    the bar and triggers dismissal (via `animationend`), so the visible
 *    countdown and the actual deadline can never disagree.
 */
export function FeedbackPrompt({
  feedbackId,
  config,
  needsConsent,
  onClose,
  onConsentDecided,
}: Props) {
  const [answered, setAnswered] = useState(false);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    shownAt.current = Date.now();
  }, [feedbackId]);

  const answer = useCallback(
    (label: string) => {
      // Response time lets the backend drop careless taps at retraining time.
      // "Not sure" is recorded too — it marks the moment as genuinely
      // ambiguous, which is itself signal; training filters it out later.
      void submitFeedback(feedbackId, label, Date.now() - shownAt.current);
      setAnswered(true);
      window.setTimeout(onClose, 900);
    },
    [feedbackId, onClose],
  );

  const decide = useCallback(
    (granted: boolean) => {
      setConsent(granted ? "granted" : "declined");
      onConsentDecided(granted);
    },
    [onConsentDecided],
  );

  return (
    <div className="ss-fb pointer-events-auto fixed bottom-5 right-5 z-50 w-[300px] overflow-hidden rounded-xl border border-white/15 bg-neutral-900/95 text-white shadow-2xl backdrop-blur">
      <style>{`
        @keyframes ss-fb-drain { from { width: 100%; } to { width: 0%; } }
        .ss-fb-bar { animation: ss-fb-drain linear forwards; }
        .ss-fb:hover .ss-fb-bar { animation-play-state: paused; }
      `}</style>

      {needsConsent ? (
        <div className="p-4">
          <div className="text-sm font-medium">감정 인식을 함께 개선할까요?</div>
          <p className="mt-2 text-xs leading-relaxed text-white/70">
            AI가 헷갈린 구간에서 가끔 짧게 여쭤봅니다. 답변은 정확도 개선에만
            쓰이며, <strong className="text-white/90">음성은 저장하지 않고</strong>{" "}
            분석된 숫자만 저장합니다.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => decide(true)}
              className="flex-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-white/90"
            >
              참여하기
            </button>
            <button
              type="button"
              onClick={() => decide(false)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
            >
              사양할게요
            </button>
          </div>
          <p className="mt-2 text-[10px] text-white/40">
            설정에서 언제든 바꿀 수 있습니다.
          </p>
        </div>
      ) : answered ? (
        <div className="px-4 py-5 text-center text-sm text-white/80">
          고맙습니다 — 정확도 개선에 반영할게요.
        </div>
      ) : (
        <>
          <div className="p-4 pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-medium">{config.question}</div>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                className="-mr-1 -mt-1 shrink-0 rounded px-1.5 text-white/40 transition hover:text-white/80"
              >
                ×
              </button>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              {config.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => answer(o.value)}
                  className="rounded-lg border border-white/15 px-2 py-2 text-xs text-white/90 transition hover:border-white/40 hover:bg-white/10"
                >
                  {o.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => answer(config.unsure_value)}
              className="mt-2 w-full rounded-lg px-2 py-1.5 text-xs text-white/50 transition hover:bg-white/5 hover:text-white/80"
            >
              {config.unsure_label}
            </button>
          </div>

          {/* Drains over display_seconds; dismissal fires on animation end, so
              hovering (which pauses the animation) also pauses the deadline. */}
          <div className="h-[3px] w-full bg-white/10">
            <div
              className="ss-fb-bar h-full bg-white/50"
              style={{ animationDuration: `${config.display_seconds}s` }}
              onAnimationEnd={onClose}
            />
          </div>
        </>
      )}
    </div>
  );
}
