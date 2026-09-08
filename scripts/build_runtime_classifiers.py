"""Fit the trained emotion classifiers and save them for RUNTIME use.

Until now the trained classifiers only ever existed inside evaluation scripts —
`train_classifier.py` measured speaker-independent accuracy and `embedding_
swap_ko.py` measured the Korean embedding swap, but neither produced an
artifact the serving pipeline could load. This script closes that gap: it fits
each classifier on ALL available data and writes it, together with the metadata
the runtime needs to reproduce the exact feature vector it was trained on.

  English  RAVDESS   · audeering embedding (1024) + prosody (14) → 8 classes
  Korean   AIHub     · XLSR-korean embedding (1024) + prosody (14) → 7 classes

The Korean model is the one validated in the embedding-swap experiment
(43.6% → 49.6%, McNemar p < 0.001), so this is what makes that result real in
the product rather than only in a results CSV.

    python scripts/build_runtime_classifiers.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from joblib import dump
from sklearn.decomposition import PCA
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

TIMELINES = REPO / "data" / "timelines"
MODELS = REPO / "backend" / "models"
MODELS.mkdir(parents=True, exist_ok=True)

# Must match the order used when the cached features were built
# (scripts/extract_features.py and scripts/eval_korean.py).
PROSODY_KEYS = [
    "f0_mean", "f0_std", "f0_min", "f0_max", "f0_range",
    "intensity_mean", "intensity_std", "intensity_min", "intensity_max",
    "jitter_local", "shimmer_local", "hnr_mean", "voiced_ratio",
    "speech_rate_approx",
]

AUDEERING = "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim"
XLSR_KOREAN = "kresnik/wav2vec2-large-xlsr-korean"
EMB_DIM = 1024

# Bound the solver. sklearn's default is unlimited iterations, which is fine on
# clean data but can hang for tens of minutes once retraining upweights viewer
# feedback: those labels are collected precisely at low-confidence moments, so
# they sit on the decision boundary, and weighting boundary points makes the
# underlying QP very slow to converge. (Observed: a 25-minute fit that finished
# in ~2s once capped.) Hitting the cap raises a ConvergenceWarning rather than
# failing, so a slightly-underconverged model is preferred over a hung script.
MAX_ITER = 1_000_000


def make_pipeline(probability: bool = True) -> Pipeline:
    """Same recipe as the evaluation scripts, optionally with probabilities.

    `probability=True` gives the runtime a calibrated confidence, which the
    visual layer needs since low confidence is what triggers neutral/gray
    rendering — but it is expensive: SVC fits one-vs-one Platt scaling with
    internal cross-validation, several times more work than a plain fit.

    So pass `probability=False` whenever a model is only going to be scored
    with `predict()` (as during retraining comparisons). Only the model that
    actually gets served needs calibrated confidence.
    """
    return Pipeline([
        ("scale", StandardScaler()),
        ("pca", PCA(n_components=0.95, random_state=0)),
        ("svm", SVC(kernel="linear", C=1.0, class_weight="balanced",
                    probability=probability, max_iter=MAX_ITER, random_state=0)),
    ])


def save(name: str, clf: Pipeline, embedding_model: str, source: str,
         X: np.ndarray, y: np.ndarray) -> None:
    bundle = {
        "pipeline": clf,
        "embedding_model": embedding_model,
        "prosody_keys": PROSODY_KEYS,
        "emb_dim": EMB_DIM,
        "classes": sorted(set(y.tolist())),
        "trained_on": source,
        "n_samples": int(len(y)),
    }
    path = MODELS / name
    dump(bundle, path)
    print(f"  saved → {path.relative_to(REPO)}  "
          f"({len(y)} samples, {len(bundle['classes'])} classes)")


def build_english() -> None:
    src = TIMELINES / "ravdess_features.npz"
    if not src.exists():
        print(f"[en] SKIP — missing {src.name} (run scripts/extract_features.py)")
        return
    d = np.load(src, allow_pickle=True)
    X, y = d["X"], d["y"]
    print(f"[en] fitting on {X.shape} …")
    clf = make_pipeline()
    clf.fit(X, y)
    save("emotion_clf.joblib", clf, AUDEERING, "RAVDESS", X, y)


def build_korean() -> None:
    feats = TIMELINES / "korean_features.npz"
    emb = TIMELINES / f"korean_emb_{XLSR_KOREAN.replace('/', '__')}.npz"
    if not feats.exists() or not emb.exists():
        print(f"[ko] SKIP — need {feats.name} + {emb.name} "
              "(run scripts/eval_korean.py and scripts/embedding_swap_ko.py)")
        return
    d = np.load(feats, allow_pickle=True)
    y = d["y"]
    prosody = d["X"][:, EMB_DIM:]          # the 14 PRAAT features
    E = np.load(emb)["E"]                  # XLSR-korean embeddings
    assert len(E) == len(y), f"embedding rows {len(E)} != labels {len(y)}"
    X = np.hstack([E.astype(prosody.dtype), prosody])
    print(f"[ko] fitting on {X.shape} (XLSR-korean + prosody) …")
    clf = make_pipeline()
    clf.fit(X, y)
    save("korean_clf.joblib", clf, XLSR_KOREAN, "AIHub 감정 분류를 위한 대화 음성",
         X, y)


def main() -> int:
    print("Building runtime classifiers\n")
    build_english()
    build_korean()
    print("\nDone. The serving pipeline will pick these up automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
