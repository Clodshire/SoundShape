"""Compare emotion models on the same clips — English (labeled) + Korean (qual).

Probes whether a multilingual (XLSR) categorical model behaves differently /
better than our current English-trained heads, especially on Korean. Run:

    python scripts/compare_emotion_models.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from transformers import pipeline  # noqa: E402

# Current categorical head (English, IEMOCAP) vs a multilingual-base candidate.
CURRENT_CAT = "superb/wav2vec2-base-superb-er"
CANDIDATE_XLSR = "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition"

CLIPS = {
    "KO (neutral TTS)": "data/samples/ko_test.wav",
    "EN (neutral TTS)": "data/samples/test.wav",
    "EN angry (RAVDESS)": "data/datasets/RAVDESS/Actor_01/03-01-05-02-01-01-01.wav",
    "EN sad (RAVDESS)": "data/datasets/RAVDESS/Actor_01/03-01-04-02-01-01-01.wav",
    "EN happy (RAVDESS)": "data/datasets/RAVDESS/Actor_01/03-01-03-02-01-01-01.wav",
}


def top3(pipe, path: str) -> str:
    preds = pipe(path, top_k=8)
    preds = sorted(preds, key=lambda p: -p["score"])[:3]
    return ", ".join(f"{p['label']}={p['score']:.2f}" for p in preds)


def main() -> int:
    print("Loading current head:", CURRENT_CAT)
    cur = pipeline("audio-classification", model=CURRENT_CAT)

    print("Loading candidate (XLSR multilingual base):", CANDIDATE_XLSR)
    try:
        cand = pipeline("audio-classification", model=CANDIDATE_XLSR)
    except Exception as e:  # noqa: BLE001
        print(f"\n!! Candidate failed to load: {e}")
        print("Reporting current model only.")
        cand = None

    for label, rel in CLIPS.items():
        p = REPO / rel
        if not p.exists():
            print(f"\n[{label}] missing: {rel}")
            continue
        print(f"\n=== {label} ===  ({rel})")
        print(f"  current (superb) : {top3(cur, str(p))}")
        if cand:
            print(f"  candidate (xlsr) : {top3(cand, str(p))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
