"use client";

// Dedicated entry point for data collection.
//
// A participant gets one link and starts immediately. Nothing else is on the
// page: no captions, no demo, no emotion field running behind the dialog —
// partly so there is nothing to distract from the stimulus, and partly so the
// test keeps the WebGL contexts it needs to render shape and motion at all.
//
//     http://localhost:3000/study
//
// Runs in research mode, which adds the crossover block after the measurement
// block. Anonymous: what is stored is the answers and an optional free-text
// group label, never a name.

import { useState } from "react";

import { CalibrationTest } from "@/components/CalibrationTest";

export default function StudyPage() {
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(false);

  // Dark like the dialog it hosts, in hard-coded colours, and for the same
  // reason: this page exists to collect perceptual data that is compared
  // across participants. See CalibrationTest.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center">
      <h1 className="text-xl font-semibold text-white">SoundShape</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/70">
        소리를 색·모양·움직임으로 바꿔 보여주는 자막을 만들고 있습니다.
        <br />
        그 표현이 사람들에게 어떻게 보이는지 알아보는 짧은 검사입니다.
      </p>

      {done ? (
        <p className="mt-8 text-sm text-emerald-400">
          참여해 주셔서 고맙습니다. 창을 닫으셔도 됩니다.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-8 h-11 rounded-full bg-white px-8 text-sm font-medium text-black transition hover:bg-white/90"
        >
          검사 시작하기
        </button>
      )}

      {open && (
        <CalibrationTest
          research
          onClose={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      )}
    </main>
  );
}
