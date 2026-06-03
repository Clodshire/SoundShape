"""Korean emotion eval on AIHub '감정 분류를 위한 대화 음성 데이터셋'.

Same recipe as the English trained classifier, on Korean speech:
  1. parse the label CSV (final label = majority vote of the 5 human evaluators)
  2. take a balanced subset (N per emotion)
  3. extract 1024-d wav2vec2 embedding + 14 prosody features (cached)
  4. train StandardScaler→PCA→linear SVM, stratified CV, report acc/F1/confusion

Honest caveat: this release has no speaker IDs, so the split is stratified-random,
NOT speaker-independent (a clip from a given speaker could appear in both train
and test). The English eval WAS speaker-independent; this Korean number is
therefore an upper-ish estimate. Noted in the output.

    python scripts/eval_korean.py
"""

from __future__ import annotations

import collections
import csv
import os
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import seaborn as sns  # noqa: E402
import torch  # noqa: E402
from sklearn.decomposition import PCA  # noqa: E402
from sklearn.metrics import (accuracy_score, classification_report,  # noqa: E402
                             confusion_matrix, f1_score)
from sklearn.model_selection import StratifiedKFold, cross_val_predict  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from sklearn.svm import SVC  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from backend.pipeline.emotion import _dimensional_model, _load_wave_16k  # noqa: E402
from backend.pipeline.prosody import extract_prosody  # noqa: E402

BASE = Path("/Users/birdhouse/Downloads/감정 분류를 위한 대화 음성 데이터셋")
CSVP = BASE / "5차년도_2차.csv"
WAVDIR = BASE / "5차년도_2차"
CACHE = REPO / "data" / "timelines" / "korean_features.npz"
OUT = REPO / "docs" / "eval"
OUT.mkdir(parents=True, exist_ok=True)

N_PER_CLASS = 250
SEED = 0
PROSODY_KEYS = ["f0_mean", "f0_std", "f0_min", "f0_max", "f0_range",
                "intensity_mean", "intensity_std", "intensity_min", "intensity_max",
                "jitter_local", "shimmer_local", "hnr_mean", "voiced_ratio",
                "speech_rate_approx"]


def majority(evals):
    e = [x.strip().lower() for x in evals if x and x.strip()]
    return collections.Counter(e).most_common(1)[0][0] if e else None


def build_subset():
    rows = []
    with open(CSVP, encoding="cp949", errors="replace") as f:
        r = csv.reader(f); next(r)
        for row in r:
            if len(row) < 13:
                continue
            lab = majority([row[3], row[5], row[7], row[9], row[11]])
            wav = WAVDIR / f"{row[0].strip()}.wav"
            if lab and wav.exists():
                rows.append((wav, lab))
    by = collections.defaultdict(list)
    for w, l in rows:
        by[l].append(w)
    rng = np.random.default_rng(SEED)
    subset = []
    for lab, ws in by.items():
        idx = rng.permutation(len(ws))[:N_PER_CLASS]
        subset += [(ws[i], lab) for i in idx]
    rng.shuffle(subset)
    return subset


def embed(processor, model, wav):
    sig = _load_wave_16k(str(wav))
    inp = processor(sig, sampling_rate=16000, return_tensors="pt", padding=True)
    with torch.no_grad():
        h = model.wav2vec2(inp["input_values"]).last_hidden_state
    return h.mean(dim=1).squeeze(0).numpy().astype(np.float32)


def extract():
    subset = build_subset()
    print(f"Balanced subset: {len(subset)} clips ({N_PER_CLASS}/class)")
    processor, model = _dimensional_model()
    X, y = [], []
    for i, (wav, lab) in enumerate(subset, 1):
        try:
            emb = embed(processor, model, wav)
            pros = extract_prosody(str(wav)).features.to_dict()
            pv = np.array([pros[k] for k in PROSODY_KEYS], dtype=np.float32)
            X.append(np.concatenate([emb, pv])); y.append(lab)
        except Exception as e:  # noqa: BLE001
            print("  skip", wav.name, str(e)[:60])
        if i % 100 == 0:
            print(f"  {i}/{len(subset)}")
    X = np.vstack(X); y = np.array(y)
    np.savez(CACHE, X=X, y=y)
    print(f"Cached {X.shape} → {CACHE.name}")
    return X, y


def main() -> int:
    if CACHE.exists():
        d = np.load(CACHE, allow_pickle=True); X, y = d["X"], d["y"]
        print(f"Loaded cached features {X.shape}")
    else:
        X, y = extract()

    clf = Pipeline([
        ("scale", StandardScaler()),
        ("pca", PCA(n_components=0.95, random_state=0)),
        ("svm", SVC(kernel="linear", C=1.0, class_weight="balanced", random_state=0)),
    ])
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
    pred = cross_val_predict(clf, X, y, cv=cv)

    acc = accuracy_score(y, pred)
    f1 = f1_score(y, pred, average="macro")
    labels = sorted(set(y.tolist()))
    print("\n" + "=" * 60)
    print(f"KOREAN 7-class emotion (N={len(y)}, stratified 5-fold)")
    print(f"  accuracy : {acc:.1%}")
    print(f"  macro-F1 : {f1:.2f}")
    print("=" * 60)
    print(classification_report(y, pred, labels=labels, zero_division=0))

    cm = confusion_matrix(y, pred, labels=labels)
    fig, ax = plt.subplots(figsize=(7.5, 6.5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Purples", cbar=False,
                xticklabels=labels, yticklabels=labels, ax=ax)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True (majority of 5 evaluators)")
    ax.set_title(f"Korean trained classifier · {acc:.0%} · 7-class · N={len(y)}")
    fig.tight_layout(); fig.savefig(OUT / "korean_confusion.png", dpi=140)

    import json
    (OUT / "korean_metrics.json").write_text(json.dumps({
        "dataset": "AIHub 감정 분류를 위한 대화 음성 (5차년도_2차)",
        "n_clips": int(len(y)), "n_per_class": N_PER_CLASS,
        "validation": "stratified 5-fold (NOT speaker-independent — no speaker IDs)",
        "accuracy": round(float(acc), 4), "macro_f1": round(float(f1), 4),
        "classes": labels,
    }, indent=2, ensure_ascii=False))
    print(f"\nSaved → docs/eval/korean_confusion.png + korean_metrics.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
