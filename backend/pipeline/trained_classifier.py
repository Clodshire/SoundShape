"""Runtime inference with the TRAINED emotion classifiers.

The categorical head shipped by default (`superb/wav2vec2-base-superb-er`) is
zero-shot and weak — 55% on English, 17.5% on Korean, the latter essentially
chance. Our own evaluation showed a trained classifier over the same features
does far better (English 79.8% speaker-independent; Korean 49.6% with the
XLSR-korean embedding). This module puts those trained classifiers on the
serving path so the product actually benefits from them.

Feature vector must match training exactly:
    [ 1024-d mean-pooled embedding | 14 PRAAT prosody features ]
with the embedding produced by the backbone recorded in the model bundle
(audeering for English, XLSR-korean for Korean).

Everything degrades gracefully: if a bundle is missing or anything fails,
`classify_trained()` returns None and the caller falls back to the zero-shot
head, so the pipeline never breaks because a model file isn't present.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple, Optional

import numpy as np
import torch

from backend.pipeline.emotion import _load_wave_16k
from backend.pipeline.prosody import extract_prosody

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# language → bundle filename. Anything not listed falls back to the English
# model, which is also what the zero-shot head was validated on.
BUNDLES = {
    "ko": "korean_clf.joblib",
    "en": "emotion_clf.joblib",
}
DEFAULT_BUNDLE = "emotion_clf.joblib"

# Dataset label → the project's EmotionCategory (long form, as used by the
# mapping config). `calm` and `disgust` follow the same collapsing the
# evaluation scripts already use (TO4 in train_classifier.py): calm reads as
# neutral, disgust as anger — the config has no distinct hue for either.
LABEL_TO_CATEGORY = {
    # RAVDESS (English)
    "neutral": "neutral",
    "calm": "neutral",
    "happy": "joy",
    "sad": "sadness",
    "angry": "anger",
    "fearful": "fear",
    "disgust": "anger",
    "surprised": "surprise",
    # AIHub (Korean)
    "happiness": "joy",
    "sadness": "sadness",
    "fear": "fear",
    "surprise": "surprise",
}

# Enabled by default; set SOUNDSHAPE_TRAINED_CLF=0 to force the zero-shot head
# (useful for A/B comparison against the pre-integration behaviour).
ENABLED = os.environ.get("SOUNDSHAPE_TRAINED_CLF", "1") != "0"


def _load_bundle(filename: str):
    """Load a model bundle, picking up retrained files without a restart.

    The modification time is part of the cache key, so replacing the file
    (as retrain_with_feedback.py does) naturally invalidates the cached copy
    while repeated calls still hit the cache.
    """
    path = MODELS_DIR / filename
    if not path.exists():
        return None
    try:
        return _load_bundle_cached(filename, path.stat().st_mtime_ns)
    except Exception:  # noqa: BLE001 — a bad artifact must not break serving
        return None


@lru_cache(maxsize=8)
def _load_bundle_cached(filename: str, _mtime_ns: int):
    from joblib import load

    return load(MODELS_DIR / filename)


@lru_cache(maxsize=2)
def _backbone(model_id: str):
    """Load the embedding backbone, mirroring how features were extracted.

    The audeering checkpoint carries a custom regression head, so its encoder
    is reached through `.wav2vec2`; plain checkpoints (XLSR) are called
    directly. Both are mean-pooled over time, exactly as in training.
    """
    if "audeering" in model_id:
        from backend.pipeline.emotion import _dimensional_model
        processor, model = _dimensional_model()
        return ("audeering", processor, model)
    from transformers import AutoFeatureExtractor, AutoModel
    fe = AutoFeatureExtractor.from_pretrained(model_id)
    model = AutoModel.from_pretrained(model_id)
    model.eval()
    return ("plain", fe, model)


def _embed(model_id: str, wav_path: str) -> np.ndarray:
    kind, proc, model = _backbone(model_id)
    signal = _load_wave_16k(wav_path)
    inputs = proc(signal, sampling_rate=16000, return_tensors="pt", padding=True)
    with torch.no_grad():
        if kind == "audeering":
            hidden = model.wav2vec2(inputs["input_values"]).last_hidden_state
        else:
            hidden = model(inputs["input_values"]).last_hidden_state
    return hidden.mean(dim=1).squeeze(0).numpy().astype(np.float32)


class TrainedPrediction(NamedTuple):
    """Result of trained-classifier inference.

    `features` is the exact vector the model scored — kept so the feedback
    loop can store it for retraining without re-analysing (or storing) audio.
    It stays server-side and is never serialized to a client.
    """

    category: str
    confidence: float
    raw_label: str
    features: np.ndarray
    embedding_model: str


def classify_trained(
    wav_path: str, language: Optional[str] = None
) -> Optional[TrainedPrediction]:
    """Predict emotion with the trained classifier for `language`.

    Returns None when unavailable — the caller then falls back to the
    zero-shot head.
    """
    if not ENABLED:
        return None
    bundle = _load_bundle(BUNDLES.get((language or "").lower(), DEFAULT_BUNDLE))
    if bundle is None:
        return None
    try:
        emb = _embed(bundle["embedding_model"], wav_path)
        pros = extract_prosody(wav_path).features.to_dict()
        pv = np.array([pros[k] for k in bundle["prosody_keys"]], dtype=np.float32)
        x = np.concatenate([emb, pv]).reshape(1, -1)

        clf = bundle["pipeline"]
        label = str(clf.predict(x)[0])
        try:
            confidence = float(clf.predict_proba(x)[0].max())
        except Exception:  # noqa: BLE001 — model fitted without probabilities
            confidence = 0.5
    except Exception:  # noqa: BLE001 — never let inference break the pipeline
        return None

    return TrainedPrediction(
        category=LABEL_TO_CATEGORY.get(label, "neutral"),
        confidence=confidence,
        raw_label=label,
        features=x.reshape(-1),
        embedding_model=bundle["embedding_model"],
    )


def available_languages() -> list[str]:
    """Languages that currently have a usable trained classifier."""
    return [lang for lang, fn in BUNDLES.items() if _load_bundle(fn) is not None]
