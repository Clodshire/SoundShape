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

## Limitations
- N = 120, 2 actors, English. A larger multi-actor + Korean evaluation is the
  next step (Korean needs a labeled set such as AIHub/KEMDy).
