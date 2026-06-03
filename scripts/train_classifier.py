"""Train + evaluate a SoundShape emotion classifier (speaker-independent).

Trains a classifier on the cached features (wav2vec2 embedding + prosody) and
evaluates it with **GroupKFold by actor** — every test clip comes from a speaker
the model never trained on, so the number reflects generalization to new voices
(no speaker leakage). This is the lightweight, GPU-free alternative to full
fine-tuning.

Reports 8-class and 4-class accuracy/F1 + confusion matrices, compared to the
zero-shot off-the-shelf baseline (docs/eval/metrics.json), and saves a final
model trained on all data.

    python scripts/train_classifier.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import seaborn as sns  # noqa: E402
from joblib import dump  # noqa: E402
from sklearn.decomposition import PCA  # noqa: E402
from sklearn.model_selection import GroupKFold, cross_val_predict  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.svm import SVC  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
FEATURES = REPO / "data" / "timelines" / "ravdess_features.npz"
OUT = REPO / "docs" / "eval"
MODEL_OUT = REPO / "backend" / "models" / "emotion_clf.joblib"
OUT.mkdir(parents=True, exist_ok=True)

EMO8 = ["neutral", "calm", "happy", "sad", "angry", "fearful", "disgust", "surprised"]
TO4 = {
    "neutral": "neu", "calm": "neu", "happy": "hap", "surprised": "hap",
    "sad": "sad", "angry": "ang", "fearful": "ang", "disgust": "ang",
}
C4 = ["ang", "hap", "neu", "sad"]


def heatmap(cm, labels, title, path):
    fig, ax = plt.subplots(figsize=(7, 6))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Greens", cbar=False,
                xticklabels=labels, yticklabels=labels, ax=ax)
    ax.set_xlabel("Predicted (trained classifier)")
    ax.set_ylabel("True")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=140)


def main() -> int:
    if not FEATURES.exists():
        print(f"Missing {FEATURES}. Run scripts/extract_features.py first.")
        return 1
    data = np.load(FEATURES, allow_pickle=True)
    X, y, groups = data["X"], data["y"], data["groups"]
    n_actors = len(set(groups.tolist()))
    print(f"Features: {X.shape}  |  {n_actors} actors  |  {len(set(y))} emotions\n")

    clf = Pipeline([
        ("scale", StandardScaler()),
        ("pca", PCA(n_components=0.95, random_state=0)),
        ("svm", SVC(kernel="linear", C=1.0, class_weight="balanced", random_state=0)),
    ])

    # Speaker-independent out-of-fold predictions (leave actors out).
    cv = GroupKFold(n_splits=n_actors)
    y_pred = cross_val_predict(clf, X, y, groups=groups, cv=cv)

    acc8 = accuracy_score(y, y_pred)
    f1m8 = f1_score(y, y_pred, average="macro")

    true4 = np.array([TO4[e] for e in y])
    pred4 = np.array([TO4[e] for e in y_pred])
    acc4 = accuracy_score(true4, pred4)
    f1m4 = f1_score(true4, pred4, average="macro")

    # Baseline (zero-shot off-the-shelf) for comparison.
    base = {}
    base_path = OUT / "metrics.json"
    if base_path.exists():
        base = json.loads(base_path.read_text())

    print("=" * 64)
    print(f"Speaker-independent (GroupKFold by actor, {n_actors} folds, N={len(y)})")
    print("-" * 64)
    if base:
        print(f"  4-class — zero-shot baseline   : {base.get('hybrid_4class_acc', 0)*100:.1f}%")
    print(f"  4-class — TRAINED classifier   : {acc4*100:.1f}%   (macro-F1 {f1m4:.2f})")
    print(f"  8-class — TRAINED classifier   : {acc8*100:.1f}%   (macro-F1 {f1m8:.2f})")
    print("=" * 64)
    print("\n8-class report:")
    print(classification_report(y, y_pred, labels=EMO8, zero_division=0))

    heatmap(confusion_matrix(y, y_pred, labels=EMO8), EMO8,
            f"Trained classifier · 8-class · {acc8:.0%} · speaker-independent",
            OUT / "trained_confusion_8.png")
    heatmap(confusion_matrix(true4, pred4, labels=C4), C4,
            f"Trained classifier · 4-class · {acc4:.0%} · speaker-independent",
            OUT / "trained_confusion_4.png")

    # Fit final model on ALL data and save it.
    clf.fit(X, y)
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    dump(clf, MODEL_OUT)

    metrics = {
        "method": "embedding(1024)+prosody(15) → StandardScaler+PCA(0.95)+linear SVM",
        "validation": f"GroupKFold by actor ({n_actors} folds) — speaker-independent",
        "n_clips": int(len(y)),
        "n_actors": n_actors,
        "trained_8class_acc": round(float(acc8), 4),
        "trained_8class_macro_f1": round(float(f1m8), 4),
        "trained_4class_acc": round(float(acc4), 4),
        "trained_4class_macro_f1": round(float(f1m4), 4),
        "zero_shot_4class_acc": base.get("hybrid_4class_acc"),
        "model_path": str(MODEL_OUT.relative_to(REPO)),
    }
    (OUT / "trained_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"\nSaved model → {MODEL_OUT.relative_to(REPO)}")
    print(f"Saved figures + trained_metrics.json → {OUT.relative_to(REPO)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
