"""Text sentiment → a valence estimate, used ONLY as a tie-breaker.

Text is strong at valence (positive vs. negative) exactly where the acoustic
model is weak, so it complements the voice. But SoundShape is prosody-first:
this signal is consulted only when the *acoustic* valence is near-zero /
uncertain (see emotion.fuse_valence), so a confidently negative tone (sarcasm)
is never overridden by positive words.

Multilingual (handles Korean + English). Model is env-overridable; if it can't
load, text_valence returns a zero / no-confidence signal so fusion is a no-op.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Tuple

from transformers import pipeline

TEXT_MODEL = os.environ.get(
    "SOUNDSHAPE_TEXT_MODEL",
    "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
)


@lru_cache(maxsize=1)
def _pipe():
    return pipeline("text-classification", model=TEXT_MODEL, top_k=None)


def text_valence(text: str) -> Tuple[float, float]:
    """Return (valence, confidence): valence = P(pos) − P(neg) ∈ [−1, +1]."""
    if not text or not text.strip():
        return 0.0, 0.0
    try:
        preds = _pipe()(text[:512])
    except Exception:  # noqa: BLE001 — fusion becomes a no-op on any failure
        return 0.0, 0.0
    # `top_k=None` → list (possibly nested) of {label, score}.
    if preds and isinstance(preds[0], list):
        preds = preds[0]

    pos = neg = 0.0
    for p in preds:
        label = str(p.get("label", "")).lower()
        score = float(p.get("score", 0.0))
        if "pos" in label or label in ("label_2", "2"):
            pos = score
        elif "neg" in label or label in ("label_0", "0"):
            neg = score
    return pos - neg, max(pos, neg)


if __name__ == "__main__":
    import sys

    for t in sys.argv[1:] or ["I'm so happy today!", "이건 정말 최악이야", "그래 잘했다"]:
        v, c = text_valence(t)
        print(f"  {t!r:40s} → valence={v:+.2f} conf={c:.2f}")
