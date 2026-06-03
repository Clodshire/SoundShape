"""Evaluate SoundShape's emotion engine on RAVDESS (reproducible).

Runs the *current* acoustic pipeline (classify_emotion: calibration + hybrid
category) on every RAVDESS clip and reports:

  • 4-class accuracy — hybrid vs the categorical-model baseline (before/after)
  • per-class precision / recall / F1
  • a confusion matrix figure
  • valence & arousal correlation (Pearson r) with canonical per-emotion targets
    — shows the honest split: arousal strong, valence weak

Text fusion is intentionally NOT exercised here: RAVDESS uses two fixed,
emotionally-neutral sentences, so this measures the pure ACOUSTIC core.

    python scripts/evaluate.py
Outputs → docs/eval/  (confusion_matrix.png, va_scatter.png, metrics.json)
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
from sklearn.metrics import (  # noqa: E402
    classification_report,
    confusion_matrix,
)

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.pipeline.datasets import load_ravdess_clips  # noqa: E402
from backend.pipeline.emotion import classify_emotion  # noqa: E402

OUT = REPO / "docs" / "eval"
OUT.mkdir(parents=True, exist_ok=True)
RAVDESS = REPO / "data" / "datasets" / "RAVDESS"

# Canonical Russell V/A targets per RAVDESS emotion (for V/A correlation).
TARGET_VA = {
    "neutral": (0.0, 0.0), "calm": (0.35, -0.45), "happy": (0.7, 0.5),
    "sad": (-0.65, -0.4), "angry": (-0.6, 0.65), "fearful": (-0.5, 0.6),
    "disgust": (-0.5, 0.35), "surprised": (0.45, 0.65),
}
# Collapse to the 4 classes the categorical model uses (fair comparison).
TRUE_TO_4 = {
    "neutral": "neu", "calm": "neu", "happy": "hap", "surprised": "hap",
    "sad": "sad", "angry": "ang", "fearful": "ang", "disgust": "ang",
}
DERIVED_TO_4 = {
    "anger": "ang", "fear": "ang", "joy": "hap", "surprise": "hap",
    "sadness": "sad", "sincerity": "neu", "neutral": "neu", "resignation": "sad",
    "sarcasm": "ang",
}
CLASSES = ["ang", "hap", "neu", "sad"]


def main() -> int:
    clips = load_ravdess_clips(RAVDESS)
    if not clips:
        print(f"No RAVDESS clips under {RAVDESS}. Run scripts/download_ravdess.py")
        return 1
    actors = sorted({c.actor for c in clips})
    print(f"Evaluating {len(clips)} clips from actors {actors} …\n")

    rows = []
    for i, c in enumerate(clips, 1):
        r = classify_emotion(str(c.path))  # no text → pure acoustic eval
        rows.append(
            {
                "true": c.emotion,
                "true4": TRUE_TO_4[c.emotion],
                "model4": r.model_label,  # categorical baseline (already 4-class)
                "hybrid4": DERIVED_TO_4.get(r.category, "neu"),
                "valence": r.valence,
                "arousal": r.arousal,
                "tv": TARGET_VA[c.emotion][0],
                "ta": TARGET_VA[c.emotion][1],
            }
        )
        if i % 30 == 0:
            print(f"  {i}/{len(clips)}")

    true4 = [r["true4"] for r in rows]
    base = [r["model4"] for r in rows]
    hyb = [r["hybrid4"] for r in rows]

    base_acc = float(np.mean([a == b for a, b in zip(true4, base)]))
    hyb_acc = float(np.mean([a == b for a, b in zip(true4, hyb)]))

    # V/A correlation with canonical targets.
    v_pred = np.array([r["valence"] for r in rows])
    a_pred = np.array([r["arousal"] for r in rows])
    v_tgt = np.array([r["tv"] for r in rows])
    a_tgt = np.array([r["ta"] for r in rows])
    v_r = float(np.corrcoef(v_pred, v_tgt)[0, 1])
    a_r = float(np.corrcoef(a_pred, a_tgt)[0, 1])

    # ── report ──
    print("\n" + "=" * 60)
    print(f"4-class emotion accuracy   (N={len(rows)}, actors={actors})")
    print(f"  categorical baseline : {base_acc:.1%}")
    print(f"  SoundShape hybrid    : {hyb_acc:.1%}   ({hyb_acc-base_acc:+.1%})")
    print("=" * 60)
    print("\nPer-class report (hybrid):")
    print(classification_report(true4, hyb, labels=CLASSES, zero_division=0))
    print(f"Valence correlation with canonical targets: r = {v_r:.2f}  (the hard axis)")
    print(f"Arousal correlation with canonical targets: r = {a_r:.2f}  (the strong axis)")

    # ── confusion matrix figure ──
    cm = confusion_matrix(true4, hyb, labels=CLASSES)
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", cbar=False,
                xticklabels=CLASSES, yticklabels=CLASSES, ax=ax)
    ax.set_xlabel("Predicted (SoundShape hybrid)")
    ax.set_ylabel("True (RAVDESS)")
    ax.set_title(f"Confusion matrix · {hyb_acc:.0%} acc · N={len(rows)}")
    fig.tight_layout()
    fig.savefig(OUT / "confusion_matrix.png", dpi=140)

    # ── V/A scatter figure ──
    colors = {
        "neutral": "#888", "calm": "#76b7b2", "happy": "#f1ce63",
        "surprised": "#ffbe7d", "sad": "#4e79a7", "angry": "#e15759",
        "fearful": "#8964b8", "disgust": "#59a14f",
    }
    fig2, ax2 = plt.subplots(figsize=(7, 6))
    for emo in TARGET_VA:
        idx = [j for j, r in enumerate(rows) if r["true"] == emo]
        if idx:
            ax2.scatter(v_pred[idx], a_pred[idx], c=colors[emo], s=60,
                        alpha=0.7, edgecolor="white", linewidth=0.7, label=emo)
    ax2.axhline(0, color="gray", lw=0.5)
    ax2.axvline(0, color="gray", lw=0.5)
    ax2.set_xlim(-1, 1); ax2.set_ylim(-1, 1)
    ax2.set_xlabel(f"Predicted valence  (r={v_r:.2f} vs target)")
    ax2.set_ylabel(f"Predicted arousal  (r={a_r:.2f} vs target)")
    ax2.set_title("Calibrated V/A by true emotion")
    ax2.legend(fontsize=8, ncols=2, loc="lower left")
    fig2.tight_layout()
    fig2.savefig(OUT / "va_scatter.png", dpi=140)

    metrics = {
        "n_clips": len(rows),
        "actors": actors,
        "baseline_4class_acc": round(base_acc, 4),
        "hybrid_4class_acc": round(hyb_acc, 4),
        "valence_r": round(v_r, 3),
        "arousal_r": round(a_r, 3),
        "note": "RAVDESS, acoustic-only (text fusion not exercised — fixed neutral sentences).",
    }
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"\nSaved → {OUT.relative_to(REPO)}/  (confusion_matrix.png, va_scatter.png, metrics.json)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
