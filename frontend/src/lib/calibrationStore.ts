// Where one viewer's calibration result lives.
//
// Kept on the device, not on the server: the weights describe how this person
// sees, they are only useful in this browser, and storing them per-account
// would turn a two-minute accessibility setting into an identity record.
// The anonymous responses that produced them go to the backend separately, as
// research data with no link back to here.

import type { ChannelWeights } from "@/lib/mapping";

const KEY = "soundshape.calibration.weights";

export function loadWeights(): ChannelWeights | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChannelWeights;
    // A corrupt or hand-edited value must not reach the renderer.
    const ok = Object.values(parsed).every(
      (v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 3,
    );
    return ok ? parsed : null;
  } catch {
    return null;
  }
}

export function saveWeights(weights: ChannelWeights): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(weights));
  } catch {
    /* private mode or full quota — the test still worked, just not persisted */
  }
}

export function clearWeights(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
