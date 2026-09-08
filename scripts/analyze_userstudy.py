"""Analyze the SoundShape user study (Test C).

Reads docs/userstudy/clips.csv (answer key) + responses.csv (collected answers),
scores each emotion answer against the clip's true emotion, and reports accuracy
**with vs. without SoundShape**, a paired significance test, and a bar chart.

    ~/.soundshape_venv/bin/python scripts/analyze_userstudy.py
"""

from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
US = REPO / "docs" / "userstudy"
OUT = REPO / "docs" / "eval"
OUT.mkdir(parents=True, exist_ok=True)

COND = {"A": "Captions only", "B": "Captions + SoundShape"}


def norm(s: str) -> str:
    return (s or "").strip().lower()


def main() -> int:
    clips_p, resp_p = US / "clips.csv", US / "responses.csv"
    if not clips_p.exists() or not resp_p.exists():
        print(f"Need {clips_p} and {resp_p}.")
        return 1

    truth, incong = {}, {}
    with open(clips_p, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            cid = norm(row["clip_id"])
            truth[cid] = norm(row["true_emotion"])
            incong[cid] = norm(row.get("incongruent", "")) in ("yes", "y", "1", "true")

    rows = []
    with open(resp_p, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pid = (row.get("participant_id") or "").strip()
            if not pid or pid.lower().startswith("example"):
                continue
            cid = norm(row["clip_id"])
            if not norm(row.get("chosen_emotion", "")) or cid not in truth:
                continue
            rows.append({
                "pid": pid, "clip": cid, "cond": (row["condition"] or "").strip().upper(),
                "chosen": norm(row["chosen_emotion"]),
                "correct": int(norm(row["chosen_emotion"]) == truth[cid]),
                "conf": float(row["confidence"]) if (row.get("confidence") or "").strip() else None,
                "incong": incong.get(cid, False),
            })

    if not rows:
        print("No real responses yet. Fill responses.csv (delete the EXAMPLE rows).")
        return 1

    n = len(rows)
    parts = sorted({r["pid"] for r in rows})
    print(f"{n} responses from {len(parts)} participants.\n")

    def acc(sub):
        return np.mean([r["correct"] for r in sub]) if sub else float("nan")

    A = [r for r in rows if r["cond"] == "A"]
    B = [r for r in rows if r["cond"] == "B"]
    accA, accB = acc(A), acc(B)

    print("=" * 56)
    print("EMOTION-RECOGNITION ACCURACY (sound off)")
    print(f"  A · captions only        : {accA:.0%}  (n={len(A)})")
    print(f"  B · captions + SoundShape: {accB:.0%}  (n={len(B)})")
    print(f"  improvement              : {accB-accA:+.0%}")
    print("=" * 56)

    # Per-participant paired difference + paired t-test (within-subject).
    diffs = []
    for p in parts:
        a = acc([r for r in A if r["pid"] == p])
        b = acc([r for r in B if r["pid"] == p])
        if not (np.isnan(a) or np.isnan(b)):
            diffs.append(b - a)
    pval = None
    if len(diffs) >= 2 and np.std(diffs) > 0:
        from scipy import stats
        t, pval = stats.ttest_1samp(diffs, 0.0)
        print(f"\nPer-participant mean improvement: {np.mean(diffs):+.0%} "
              f"(n={len(diffs)}, paired t-test p = {pval:.3f})")
        if pval < 0.05:
            print("  → statistically significant (p < 0.05).")

    # Sub-analysis: incongruent (sarcasm/suppressed) clips — the hero case.
    iA = [r for r in A if r["incong"]]; iB = [r for r in B if r["incong"]]
    if iA and iB:
        print(f"\nIncongruent clips (sarcasm/suppressed): "
              f"A {acc(iA):.0%} → B {acc(iB):.0%}  ({acc(iB)-acc(iA):+.0%})")

    # Confidence
    cA = [r["conf"] for r in A if r["conf"] is not None]
    cB = [r["conf"] for r in B if r["conf"] is not None]
    if cA and cB:
        print(f"\nMean confidence: A {np.mean(cA):.1f} → B {np.mean(cB):.1f} (of 5)")

    # Chart
    fig, ax = plt.subplots(figsize=(5.5, 5))
    bars = ax.bar(["Captions\nonly", "Captions +\nSoundShape"],
                  [accA * 100, accB * 100], color=["#9aa", "#7c3aed"])
    for bar, v in zip(bars, [accA, accB]):
        ax.text(bar.get_x() + bar.get_width() / 2, v * 100 + 1, f"{v:.0%}",
                ha="center", fontweight="bold")
    ax.set_ylabel("Emotion-recognition accuracy (%)")
    ax.set_ylim(0, 100)
    title = "SoundShape user study (sound off)"
    if pval is not None:
        title += f"\np = {pval:.3f}, N = {len(parts)}"
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(OUT / "userstudy_result.png", dpi=140)
    print(f"\nSaved → docs/eval/userstudy_result.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
