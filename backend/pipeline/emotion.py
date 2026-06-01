"""Speech emotion classification — dual-head architecture.

Two complementary models, both built on wav2vec 2.0:

  Categorical  — superb/wav2vec2-base-superb-er
                 Pre-trained on IEMOCAP, outputs 4 discrete classes:
                   ang(er), hap(piness), neu(tral), sad(ness)
                 Cheap, gives a hard label + confidence.

  Dimensional  — audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim
                 Pre-trained on MSP-Podcast, regression head outputs
                 arousal, dominance, valence each in [0, 1].
                 More expressive — gives continuous coordinates on
                 Russell's circumplex (1980).

The two outputs are unified into an EmotionResult that matches the
TypeScript `Emotion` contract the frontend already consumes (Phase 1).

Citations
  Baevski et al. 2020          — wav2vec 2.0
  Pepino et al. 2021           — Emotion recognition from speech using wav2vec 2.0
  Wagner et al. 2023           — Dawn of the transformer era in SER
  Russell 1980                 — A circumplex model of affect
  Burkhardt et al. 2022 (MSP)  — audeering model card / MSP-Podcast benchmark
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Optional, Tuple

import numpy as np
import soundfile as sf
import torch
import torch.nn as nn
from transformers import Wav2Vec2Processor, pipeline
from transformers.models.wav2vec2.modeling_wav2vec2 import (
    Wav2Vec2Model,
    Wav2Vec2PreTrainedModel,
)

# Model IDs are env-overridable so a better (e.g. Korean fine-tuned or
# multilingual) checkpoint can be swapped in with zero code change:
#     SOUNDSHAPE_CATEGORICAL_MODEL=...  SOUNDSHAPE_DIMENSIONAL_MODEL=...
# Defaults are the validated English checkpoints. See docs/model_evaluation.md
# for the multilingual evaluation and why these remain the defaults.
CATEGORICAL_MODEL = os.environ.get(
    "SOUNDSHAPE_CATEGORICAL_MODEL", "superb/wav2vec2-base-superb-er"
)
DIMENSIONAL_MODEL = os.environ.get(
    "SOUNDSHAPE_DIMENSIONAL_MODEL",
    "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim",
)

# Approximate Russell-1980 V/A placements for the 4 categorical labels.
# Used as a fallback when the dimensional model isn't loaded.
CATEGORY_TO_VA: dict[str, tuple[float, float]] = {
    "ang": (-0.7, 0.7),
    "hap": (0.7, 0.6),
    "neu": (0.0, 0.0),
    "sad": (-0.6, -0.4),
}


@dataclass
class EmotionResult:
    """Unified emotion output — matches the frontend's Emotion type."""

    category: str  # one of: ang, hap, neu, sad
    category_confidence: float  # [0, 1]
    valence: float  # [-1, +1]
    arousal: float  # [-1, +1]
    dominance: Optional[float]  # [-1, +1] when dimensional model was used

    def to_dict(self) -> dict:
        return asdict(self)


# ─────────────────────────────────────────────────────────────────────
# Categorical head
# ─────────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _categorical_pipeline():
    return pipeline("audio-classification", model=CATEGORICAL_MODEL)


def classify_categorical(wav_path: str) -> Tuple[str, float]:
    pipe = _categorical_pipeline()
    results = pipe(wav_path)
    top = results[0]
    return top["label"], float(top["score"])


# ─────────────────────────────────────────────────────────────────────
# Dimensional head (audeering)
#
# The audeering checkpoint isn't a stock classification head — it has
# a custom regression head. We mirror their public reference code
# (https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim).
# ─────────────────────────────────────────────────────────────────────


class _RegressionHead(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.dense = nn.Linear(config.hidden_size, config.hidden_size)
        self.dropout = nn.Dropout(config.final_dropout)
        self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

    def forward(self, features):
        x = self.dropout(features)
        x = self.dense(x)
        x = torch.tanh(x)
        x = self.dropout(x)
        return self.out_proj(x)


class _EmotionModel(Wav2Vec2PreTrainedModel):
    # transformers 5.x introduced an `all_tied_weights_keys` property that
    # `from_pretrained()` reads while finalizing the load. wav2vec2 has no
    # tied weights, so an empty dict is the right answer.
    all_tied_weights_keys: dict = {}

    def __init__(self, config):
        super().__init__(config)
        self.config = config
        self.wav2vec2 = Wav2Vec2Model(config)
        self.classifier = _RegressionHead(config)
        self.init_weights()

    def forward(self, input_values, attention_mask=None):
        outputs = self.wav2vec2(
            input_values=input_values, attention_mask=attention_mask
        )
        hidden = outputs.last_hidden_state.mean(dim=1)
        return self.classifier(hidden)


@lru_cache(maxsize=1)
def _dimensional_model():
    processor = Wav2Vec2Processor.from_pretrained(DIMENSIONAL_MODEL)
    model = _EmotionModel.from_pretrained(DIMENSIONAL_MODEL)
    model.eval()
    return processor, model


def _load_wave_16k(wav_path: str) -> np.ndarray:
    signal, sr = sf.read(wav_path)
    if signal.ndim > 1:
        signal = signal.mean(axis=1)
    signal = signal.astype(np.float32)
    if sr != 16000:
        import librosa
        signal = librosa.resample(signal, orig_sr=sr, target_sr=16000)
    return signal


def classify_dimensional(wav_path: str) -> Tuple[float, float, float]:
    """Return (valence, arousal, dominance) each in [-1, +1]."""
    processor, model = _dimensional_model()
    signal = _load_wave_16k(wav_path)
    inputs = processor(
        signal, sampling_rate=16000, return_tensors="pt", padding=True
    )
    with torch.no_grad():
        out = model(inputs["input_values"]).squeeze(0).numpy()
    # audeering model output order: arousal, dominance, valence ∈ [0, 1]
    arousal = (float(out[0]) - 0.5) * 2
    dominance = (float(out[1]) - 0.5) * 2
    valence = (float(out[2]) - 0.5) * 2
    return valence, arousal, dominance


# ─────────────────────────────────────────────────────────────────────
# Unified entry point
# ─────────────────────────────────────────────────────────────────────


def classify_emotion(
    wav_path: str, use_dimensional: bool = True
) -> EmotionResult:
    category, confidence = classify_categorical(wav_path)
    if use_dimensional:
        valence, arousal, dominance = classify_dimensional(wav_path)
    else:
        valence, arousal = CATEGORY_TO_VA[category]
        dominance = None
    return EmotionResult(
        category=category,
        category_confidence=confidence,
        valence=valence,
        arousal=arousal,
        dominance=dominance,
    )


if __name__ == "__main__":
    import sys
    from pprint import pprint

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.emotion <wav_path>")
        sys.exit(1)

    r = classify_emotion(sys.argv[1])
    pprint(r.to_dict())
