"""Per-video prosody baseline for hybrid rendering.

Measured arousal is only meaningful relative to something. PRAAT intensity is
reported against the recording's own level, so absolute dB says as much about
the mastering as about the voice — on RAVDESS the per-actor gain spread is
14.3 dB, larger than the 11.7 dB gap between normal and strong delivery. Pitch
has the same problem in a different form: a 220 Hz voice is agitated for one
speaker and ordinary for another.

The fix is to score every segment against a baseline drawn from the same video,
which is also how a listener hears it — loud compared with how this person has
been speaking, not loud in absolute terms.

The baseline is a RUNNING median over the segments seen so far, deliberately
not a whole-file median: the streaming path cannot see the future, and using a
different rule in the batch path would make the two disagree on the same video.
A median (rather than a mean) keeps one shouted line from moving the baseline.

    ref = ProsodyReference()
    for prosody in segments:
        baseline = ref.snapshot()      # None until enough segments accumulate
        visual = map_emotion_to_visual(emotion, prosody, baseline)
        ref.update(prosody)            # AFTER mapping — see snapshot()
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional

_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "mapping_config.json"
)

# Only the features measured arousal actually consumes are tracked.
_TRACKED = ("f0_mean", "intensity_mean", "f0_range", "speech_rate_approx")


@lru_cache(maxsize=1)
def _min_segments() -> int:
    try:
        with open(_CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        return int(cfg["measured_arousal"]["reference"]["min_segments"])
    except Exception:  # noqa: BLE001 — a bad config must not break serving
        return 3


class ProsodyReference:
    """Running median of the prosody features measured arousal reads."""

    def __init__(self, min_segments: Optional[int] = None) -> None:
        self._values: Dict[str, List[float]] = {k: [] for k in _TRACKED}
        self._n = 0
        self._min = _min_segments() if min_segments is None else min_segments

    def update(self, prosody: Dict[str, Any]) -> None:
        self._n += 1
        for key in _TRACKED:
            value = prosody.get(key)
            if value is None:
                continue
            try:
                self._values[key].append(float(value))
            except (TypeError, ValueError):
                continue

    def snapshot(self) -> Optional[Dict[str, float]]:
        """The baseline to map against, or None while it is too thin to trust.

        Below `min_segments` there is no usable baseline: with a single segment
        the median IS that segment, every deviation is zero, and every glyph
        would render mid-scale. Returning None there sends the mapping down the
        absolute path instead, which is less accurate but not degenerate.

        Call this BEFORE update() for the current segment. Including a segment
        in its own baseline pulls it toward the middle, which is exactly the
        difference the rendering is trying to show.
        """
        if self._n < self._min:
            return None
        out = {k: median(v) for k, v in self._values.items() if v}
        return out or None

    def __len__(self) -> int:
        return self._n
