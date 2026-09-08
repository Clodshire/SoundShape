"""Test B (zero-shot) on Korean: how well does the DEPLOYED system read Korean?

Runs the actual pipeline `classify_emotion` (off-the-shelf categorical + audeering
dimensional + calibration + hybrid derive_category) on Korean clips — NO Korean
training — and scores its derived category against the dataset's 7-class label.
This is the honest "out-of-the-box on Korean" number, parallel to the English
55% zero-shot baseline. Acoustic-only (no text fusion), to match English Test B.

Checkpointed (every 25 clips) so sleep/kills resume instead of restarting.

    ~/.soundshape_venv/bin/python scripts/eval_korean_zeroshot.py
"""

from __future__ import annotations

import collections
import csv
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import seaborn as sns  # noqa: E402
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from backend.pipeline.emotion import classify_emotion  # noqa: E402

BASE = Path("/Users/birdhouse/Downloads/감정 분류를 위한 대화 음성 데이터셋")
CSVP = BASE / "5차년도_2차.csv"
WAVDIR = BASE / "5차년도_2차"
OUT = REPO / "docs" / "eval"
OUT.mkdir(parents=True, exist_ok=True)
CKPT = REPO / "data" / "timelines" / "korean_zeroshot_ckpt.json"

N_PER_CLASS = 80
SEED = 0
KO_CLASSES = ["neutral", "happiness", "sadness", "angry", "disgust", "surprise", "fear"]
# our derived (long) category → this dataset's label set
DERIVED_TO_KO = {
    "anger": "angry", "fear": "fear", "joy": "happiness", "sadness": "sadness",
    "surprise": "surprise", "neutral": "neutral", "sincerity": "neutral",
    "resignation": "sadness", "sarcasm": "angry",
}


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
                rows.append((str(wav), lab))
    by = collections.defaultdict(list)
    for w, l in rows:
        by[l].append(w)
    rng = np.random.default_rng(SEED)
    sub = []
    for lab, ws in by.items():
        idx = rng.permutation(len(ws))[:N_PER_CLASS]
        sub += [(ws[i], lab) for i in idx]
    rng.shuffle(sub)
    return sub


def main() -> int:
    subset = build_subset()
    total = len(subset)
    y_true, y_pred, start = [], [], 0
    if CKPT.exists():
        d = json.loads(CKPT.read_text())
        y_true, y_pred, start = d["y_true"], d["y_pred"], d["done"]
        print(f"Resuming from {start}/{total}")
    else:
        print(f"Zero-shot on {total} Korean clips ({N_PER_CLASS}/class)…")

    for i in range(start, total):
        wav, lab = subset[i]
        try:
            cat = classify_emotion(wav).category  # acoustic only, no text
            y_pred.append(DERIVED_TO_KO.get(cat, "neutral"))
            y_true.append(lab)
        except Exception as e:  # noqa: BLE001
            print("  skip", str(e)[:60])
        if (i + 1) % 25 == 0 or i == total - 1:
            CKPT.write_text(json.dumps({"y_true": y_true, "y_pred": y_pred, "done": i + 1}))
            print(f"  {i + 1}/{total} (checkpointed)")

    yt, yp = np.array(y_true), np.array(y_pred)
    acc = accuracy_score(yt, yp)
    f1 = f1_score(yt, yp, average="macro")
    # also exclude disgust (our system has no disgust category — fair view)
    mask = yt != "disgust"
    acc6 = accuracy_score(yt[mask], yp[mask])

    print("\n" + "=" * 60)
    print(f"KOREAN ZERO-SHOT (deployed system, no Korean training, N={len(yt)})")
    print(f"  7-class accuracy        : {acc:.1%}   (chance 14.3%)")
    print(f"  6-class (excl. disgust) : {acc6:.1%}   (our system has no 'disgust')")
    print(f"  macro-F1                : {f1:.2f}")
    print("=" * 60)

    cm = confusion_matrix(yt, yp, labels=KO_CLASSES)
    fig, ax = plt.subplots(figsize=(7.5, 6.5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Oranges", cbar=False,
                xticklabels=KO_CLASSES, yticklabels=KO_CLASSES, ax=ax)
    ax.set_xlabel("Predicted (deployed system)"); ax.set_ylabel("True")
    ax.set_title(f"Korean ZERO-SHOT · {acc:.0%} · 7-class · N={len(yt)}")
    fig.tight_layout(); fig.savefig(OUT / "korean_zeroshot_confusion.png", dpi=140)

    (OUT / "korean_zeroshot_metrics.json").write_text(json.dumps({
        "dataset": "AIHub 감정 분류를 위한 대화 음성 (5차년도_2차)",
        "system": "deployed (off-the-shelf, no Korean training), acoustic-only",
        "n_clips": int(len(yt)),
        "accuracy_7class": round(float(acc), 4),
        "accuracy_6class_excl_disgust": round(float(acc6), 4),
        "macro_f1": round(float(f1), 4),
    }, indent=2, ensure_ascii=False))
    print("Saved → docs/eval/korean_zeroshot_confusion.png + korean_zeroshot_metrics.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
