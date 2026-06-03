"""Extract features for the trained-classifier evaluation.

Per RAVDESS clip: a 1024-d wav2vec2 embedding (mean-pooled hidden state from the
dimensional model's backbone) + the 15 interpretable PRAAT prosody features →
a single feature vector. Cached to data/timelines/ravdess_features.npz so
training can iterate without re-extracting (extraction is the slow part).

    python scripts/extract_features.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.pipeline.datasets import load_ravdess_clips  # noqa: E402
from backend.pipeline.emotion import _dimensional_model, _load_wave_16k  # noqa: E402
from backend.pipeline.prosody import extract_prosody  # noqa: E402

RAVDESS = REPO / "data" / "datasets" / "RAVDESS"
OUT = REPO / "data" / "timelines" / "ravdess_features.npz"

PROSODY_KEYS = [
    "f0_mean", "f0_std", "f0_min", "f0_max", "f0_range",
    "intensity_mean", "intensity_std", "intensity_min", "intensity_max",
    "jitter_local", "shimmer_local", "hnr_mean", "voiced_ratio",
    "speech_rate_approx",
]


def embed(processor, model, wav_path: str) -> np.ndarray:
    signal = _load_wave_16k(wav_path)
    inputs = processor(signal, sampling_rate=16000, return_tensors="pt", padding=True)
    with torch.no_grad():
        hidden = model.wav2vec2(inputs["input_values"]).last_hidden_state
        return hidden.mean(dim=1).squeeze(0).numpy().astype(np.float32)


def main() -> int:
    clips = load_ravdess_clips(RAVDESS)
    if not clips:
        print("No clips found. Run scripts/download_ravdess.py first.")
        return 1
    processor, model = _dimensional_model()
    print(f"Extracting features for {len(clips)} clips…")

    X, y, groups = [], [], []
    for i, c in enumerate(clips, 1):
        emb = embed(processor, model, str(c.path))
        pros = extract_prosody(str(c.path)).features.to_dict()
        pros_vec = np.array([pros[k] for k in PROSODY_KEYS], dtype=np.float32)
        X.append(np.concatenate([emb, pros_vec]))
        y.append(c.emotion)
        groups.append(c.actor)
        if i % 40 == 0:
            print(f"  {i}/{len(clips)}")

    X = np.vstack(X)
    np.savez(
        OUT,
        X=X,
        y=np.array(y),
        groups=np.array(groups),
        prosody_keys=np.array(PROSODY_KEYS),
        emb_dim=X.shape[1] - len(PROSODY_KEYS),
    )
    print(f"\nSaved {X.shape} → {OUT.relative_to(REPO)}  "
          f"(emb={X.shape[1]-len(PROSODY_KEYS)} + prosody={len(PROSODY_KEYS)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
