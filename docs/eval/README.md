# Evaluation results (Test B)

Reproducible: `python scripts/evaluate.py` (runs the current acoustic pipeline
on the RAVDESS clips in the repo). Figures + `metrics.json` regenerate here.

## Dataset
RAVDESS, **120 clips**, actors 01 (male) + 02 (female), all 8 emotions ×
2 intensities × 2 sentences × 2 repetitions. (Extensible: download more actors
with `scripts/download_ravdess.py`.) Acoustic-only — RAVDESS uses two fixed,
emotionally-neutral sentences, so the text tie-breaker isn't exercised; this
measures the pure voice-based core.

## Headline numbers

| Metric | Result |
|---|---|
| 4-class accuracy — categorical baseline | **50.8%** |
| 4-class accuracy — **SoundShape hybrid** (calibration + V/A fusion) | **55.0%** (+4.2) |
| Arousal correlation w/ canonical targets | **r = 0.73** (strong) |
| Valence correlation w/ canonical targets | **r = 0.42** (weak — the known hard axis) |

Per-class F1 (hybrid): anger **0.76**, happy 0.52, neutral 0.36, sad 0.35.
Anger — the highest-stakes, highest-arousal emotion — is detected most reliably
(precision 0.83, recall 0.71).

## Interpretation (honest)

- **Arousal is the reliable axis** (r = 0.73). The V/A scatter shows it: clips
  separate cleanly *vertically* (calm at the bottom, anger/fear/surprise at the
  top). This is what drives our size / saturation / motion — and it's solid.
- **Valence is the hard axis** (r = 0.42) — a field-wide limitation of acoustic
  emotion recognition, not specific to our model. Positive emotions (happy,
  surprised) overlap horizontally with everything. This is exactly why we added
  the calibration, the V/A hybrid, and the text tie-breaker — and why the real
  next step is fine-tuning (see ../model_evaluation.md).
- The hybrid beats the raw categorical model by 4.2 points and, critically,
  recovers "sad" (which the categorical head never predicted).

## Figures
- `confusion_matrix.png` — 4-class confusion (hybrid).
- `va_scatter.png` — calibrated valence/arousal of every clip, colored by true
  emotion. The vertical (arousal) separation vs. horizontal (valence) overlap
  is the visual proof of the r = 0.73 / 0.42 split.

## Trained classifier (the accuracy ceiling, speaker-independent)

Beyond the zero-shot baseline, we trained a lightweight classifier on features
(1024-d wav2vec2 embedding + 14 PRAAT prosody features) and evaluated it
**speaker-independently** — `GroupKFold` by actor, 8 actors / 480 clips, so
every test clip comes from a voice the model never trained on (no leakage).
No GPU; it's `StandardScaler → PCA(0.95) → linear SVM`. Reproduce:
`python scripts/extract_features.py && python scripts/train_classifier.py`.

| Metric | Zero-shot (off-the-shelf) | **Trained (speaker-independent)** |
|---|---|---|
| 4-class accuracy | 55.0% | **79.8%** |
| 8-class accuracy | — | **74.2%** (macro-F1 0.74) |

Per-class F1 (8-class): angry **0.87**, fearful 0.82, surprised 0.77, happy
0.72, disgust 0.72, neutral 0.71, calm 0.70, sad 0.61. The previously weak
classes improved sharply (happy 0.52→0.72, sad 0.35→0.61). Remaining confusions
(calm↔sad, happy↔surprised) are the same ones humans make on RAVDESS.

`trained_confusion_8.png` / `trained_confusion_4.png` show the matrices.

**Report both numbers, honestly:**
- **55% zero-shot** = generalization (untrained, cross-dataset) — what you'd get
  on unseen content out of the box.
- **80% trained** = capability ceiling on RAVDESS with proper speaker-
  independent validation.

> Caveat: the trained classifier is **in-domain (English, acted RAVDESS)**. It
> is NOT yet validated on Korean or real media, and may not transfer there — so
> it is saved (`backend/models/emotion_clf.joblib`) and reported as a capability
> result, not silently swapped into production. Generalizing it needs diverse +
> Korean training data (AIHub/KEMDy) — the documented next step.

## Limitations
- Zero-shot baseline: N = 120, 2 actors. Trained eval: N = 480, 8 actors,
  English only. Korean evaluation needs a labeled set (AIHub/KEMDy).
- Cached features (`data/timelines/ravdess_features.npz`) and the trained model
  (`backend/models/emotion_clf.joblib`) are git-ignored but regenerate from the
  two scripts above.
