/**
 * Probe for PromptPacer, driven by backend/tests/test_feedback_pacing.py.
 *
 * The pacing rules ("not too often, not twice for the same moment, not too
 * many per video") are the difference between a helpful prompt and one the
 * viewer disables the feature over — worth locking down in tests. The class
 * takes `now` explicitly, so the whole thing is deterministic.
 *
 * Prints one JSON line per scenario.
 */

import { PromptPacer } from "@/lib/feedbackClient";

const results: Record<string, unknown> = {};

// Same moment must never be asked about twice.
{
  const p = new PromptPacer(120, 5);
  const first = p.canShow("a", 0);
  p.markShown("a", 0);
  results.no_repeat = { first, second: p.canShow("a", 10_000_000) };
}

// Minimum spacing between prompts.
{
  const p = new PromptPacer(120, 5);
  p.markShown("a", 1_000_000);
  results.interval = {
    tooSoon: p.canShow("b", 1_000_000 + 119_000),
    justRight: p.canShow("b", 1_000_000 + 120_000),
  };
}

// Per-video cap.
{
  const p = new PromptPacer(0, 3);
  let t = 0;
  const shown: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    const id = `id${i}`;
    const ok = p.canShow(id, (t += 1000));
    if (ok) p.markShown(id, t);
    shown.push(ok);
  }
  results.cap = { shown, allowed: shown.filter(Boolean).length };
}

// A new video restores the budget.
{
  const p = new PromptPacer(0, 2);
  p.markShown("a", 1000);
  p.markShown("b", 2000);
  const blocked = p.canShow("c", 3000);
  p.resetForNewVideo();
  results.reset = { blockedBefore: blocked, allowedAfter: p.canShow("c", 4000) };
}

process.stdout.write(JSON.stringify(results) + "\n");
