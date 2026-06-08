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

## English vs Korean — the full Test B picture

| | Zero-shot (deployed, no training) | Trained classifier |
|---|---|---|
| **English** (RAVDESS, acted) | 55.0% (4-class) | **79.8%** (4-cls) / 74.2% (8-cls) |
| **Korean** (AIHub, conversational) | **17.5%** (7-class, ≈ chance 14.3%) | **43.6%** (7-class) |

Two honest, useful findings:
1. **Off-the-shelf English models barely work on Korean conversational speech**
   (17.5% ≈ chance) — concrete proof of the documented "models are English"
   limitation. (They mostly collapse Korean clips into a couple of categories.)
2. **Training adds ~25 points in BOTH languages** (EN +25, KO +26), so the
   feature-based learning approach transfers. Full fine-tuning on Korean is the
   ceiling beyond this.

`korean_zeroshot_*` in this folder; reproduce with
`scripts/eval_korean_zeroshot.py`.

## Korean evaluation (the audience language)

Same recipe, on **AIHub 감정 분류를 위한 대화 음성 데이터셋** (`scripts/eval_korean.py`):
1750 clips (250/class), label = majority vote of 5 human evaluators, features =
embedding + prosody, StandardScaler→PCA→linear SVM, stratified 5-fold CV.

| Metric | Result |
|---|---|
| 7-class accuracy | **43.6%** |
| macro-F1 | **0.44** |
| chance (7-class) | 14.3% |

Per-class F1: fear **0.55**, surprise 0.48, happiness 0.43, neutral 0.41,
angry 0.40, disgust 0.39, sadness 0.39.

**Read it honestly — and it's a real result:**
- **3× above chance** (43.6% vs 14.3%) on a 7-way task → the model genuinely
  learns Korean emotion patterns.
- It's **far harder than the English 74%/80%**, but mostly because of the
  *data*, not the language: RAVDESS is **acted, exaggerated, clean**; this AIHub
  set is **spontaneous conversational** speech with **noisy labels** (5
  evaluators often disagree on subtle conversational emotion). Published 7-class
  results on this kind of Korean conversational data sit ~40–55% — we're in range.
- The best classes are **fear and surprise** (high-arousal) — consistent with
  the English finding that *arousal* is the reliable axis. Since arousal drives
  most of SoundShape's visual (size/saturation/motion), the visualization stays
  meaningful in Korean even where the fine category is uncertain.
- The hardest confusions (angry↔disgust↔sadness) are subtle negative-valence
  emotions — exactly the valence-is-hard problem, in Korean.

**Caveat:** no speaker IDs in this release → stratified-random CV, not
speaker-independent (the English eval was speaker-independent), so this is an
optimistic-ish estimate. Higher numbers are reachable with more of the 19k clips
(we used 250/class), a multilingual embedding backbone, or full fine-tuning.

## Limitations
- Zero-shot baseline: N = 120, 2 actors. English trained eval: N = 480, 8
  actors, speaker-independent. Korean: N = 1750, stratified-random (acted vs
  conversational data are not directly comparable).
- Cached features (`data/timelines/*.npz`) and the trained model
  (`backend/models/emotion_clf.joblib`) are git-ignored but regenerate from the
  scripts.
