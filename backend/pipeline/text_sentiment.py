"""Text sentiment → a valence estimate, used ONLY as a tie-breaker.

Text is strong at valence (positive vs. negative) exactly where the acoustic
model is weak, so it complements the voice. But SoundShape is prosody-first:
this signal is consulted only when the *acoustic* valence is near-zero /
uncertain (see emotion.fuse_valence), so a confidently negative tone (sarcasm)
is never overridden by positive words.

Per-language routing: a general multilingual model handles English (and the
fallback), and a Korean-validated model handles Korean — because the
multilingual model mislabels clear Korean negatives (verified). Each model is
env-overridable; if one can't load, text_valence returns a zero / no-confidence
signal so fusion is a no-op.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import List, Tuple

from transformers import pipeline

# language → model id (env-overridable). "default" is the fallback.
TEXT_MODELS = {
    "default": os.environ.get(
        "SOUNDSHAPE_TEXT_MODEL_EN",
        "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
    ),
    "en": os.environ.get(
        "SOUNDSHAPE_TEXT_MODEL_EN",
        "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
    ),
    "ko": os.environ.get(
        "SOUNDSHAPE_TEXT_MODEL_KO",
        "WhitePeak/bert-base-cased-Korean-sentiment",
    ),
}


@lru_cache(maxsize=4)
def _pipe(model_id: str):
    return pipeline("text-classification", model=model_id, top_k=None)


def _pos_neg(preds: List[dict]) -> Tuple[float, float]:
    """Extract (P_positive, P_negative) from any label scheme.

    Handles named labels (…'positive'/'negative'…) and LABEL_n schemes:
    binary → LABEL_1 = pos / LABEL_0 = neg; ternary → LABEL_2 = pos / 0 = neg.
    """
    if any("pos" in str(p["label"]).lower() or "neg" in str(p["label"]).lower()
           for p in preds):
        pos = next((float(p["score"]) for p in preds
                    if "pos" in str(p["label"]).lower()), 0.0)
        neg = next((float(p["score"]) for p in preds
                    if "neg" in str(p["label"]).lower()), 0.0)
        return pos, neg
    idx = {}
    for p in preds:
        m = re.search(r"(\d+)", str(p["label"]))
        if m:
            idx[int(m.group(1))] = float(p["score"])
    if not idx:
        return 0.0, 0.0
    return idx.get(max(idx), 0.0), idx.get(min(idx), 0.0)


def text_valence(text: str, language: str = "en") -> Tuple[float, float]:
    """Return (valence, confidence): valence = P(pos) − P(neg) ∈ [−1, +1]."""
    if not text or not text.strip():
        return 0.0, 0.0
    model_id = TEXT_MODELS.get(language, TEXT_MODELS["default"])
    try:
        preds = _pipe(model_id)(text[:512])
    except Exception:  # noqa: BLE001 — fusion becomes a no-op on any failure
        return 0.0, 0.0
    if preds and isinstance(preds[0], list):
        preds = preds[0]
    pos, neg = _pos_neg(preds)
    return pos - neg, max(pos, neg)


if __name__ == "__main__":
    import sys

    samples = [
        ("I'm so happy today!", "en"),
        ("this is the worst", "en"),
        ("정말 행복해요", "ko"),
        ("이건 정말 최악이야", "ko"),
        ("너무 슬프고 우울해", "ko"),
    ]
    if len(sys.argv) > 1:
        samples = [(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "en")]
    for t, lang in samples:
        v, c = text_valence(t, lang)
        print(f"  [{lang}] {t!r:28s} → valence={v:+.2f} conf={c:.2f}")
