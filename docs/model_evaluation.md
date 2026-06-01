# Emotion model evaluation — multilingual / Korean support

> Why SoundShape uses the emotion models it does, what alternatives we tried,
> and the honest state of Korean support.

## The components

SoundShape derives emotion from the **voice signal** (never the transcript) via
two wav2vec 2.0 heads:

| Head | Model | Trained on | Output |
|---|---|---|---|
| Categorical | `superb/wav2vec2-base-superb-er` | IEMOCAP (English) | ang / hap / neu / sad |
| Dimensional | `audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim` | MSP-Podcast (English) | valence / arousal / dominance |

Captions use **Whisper large-v3-turbo**, which *is* strongly multilingual and
was verified accurate on Korean. The gap is **emotion**, not transcription.

## The question

The wav2vec2 *architecture* is language-agnostic, and Korean wav2vec2 models
exist. But "multilingual base" ≠ "good at Korean emotion": most emotion
checkpoints had their *emotion head* trained on English affect data, so the
language understanding transfers but the emotion mapping is English-learned.
We tested rather than assumed.

## What we tried

**Candidate:** `ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition` —
built on the multilingual **XLSR** base (heard Korean during pretraining),
8-emotion categorical head.

**Result: it does not load correctly on our stack (transformers 5.x).** The
checkpoint stores its classification head under legacy key names
(`classifier.output.weight`), so on load the head comes up `MISSING` and is
randomly initialized. Every prediction collapses to ~0.125 across all 8 classes
— i.e. **uniform random**:

```
EN angry  (ground truth: angry)
  current (superb)  : ang=0.96  ✓
  candidate (xlsr)  : sad=0.14, happy=0.13, calm=0.13   ← random head

KO neutral TTS
  current (superb)  : neu=0.74  (reasonable)
  candidate (xlsr)  : calm=0.13, sad=0.13, happy=0.13   ← random head
```

Making it work would require manually remapping the head weights — fragile, and
the payoff is still an *English-trained* head. Low return for the competition
timeline.

## Decision

1. **Keep the validated English checkpoints as defaults.** The current
   categorical head is weak (~50% on RAVDESS, never predicts "sad") but at
   least produces non-random, partially-correct output; the dimensional head
   gives literature-consistent arousal (see `notebooks/02`).
2. **Make the model IDs env-swappable** (`SOUNDSHAPE_CATEGORICAL_MODEL`,
   `SOUNDSHAPE_DIMENSIONAL_MODEL`) so a Korean-fine-tuned or fixed multilingual
   checkpoint drops in with **zero code change**.
3. **The real Korean path is fine-tuning** on a Korean emotion corpus
   (**AIHub 감정 음성**, **KEMDy19/KESDy18**) — listed as future work in
   `02_TECHSTACK.md`. This is the honest, highest-impact route; a multilingual
   base alone does not deliver it.

## What is *already* Korean-valid today

The **prosody modulation** layer (jitter, shimmer, intensity, speech rate →
motion/size) is pure acoustic physics and **language-independent**. So even
with an English-trained emotion head, the part of the visual driven by measured
prosody is valid for Korean speech. Arousal cues (loud/fast/high-pitch =
activated) are also largely cross-linguistic (Pell et al. 2009); valence is the
axis most likely to need Korean calibration.

## Calibration + hybrid category (shipped)

Two data-derived improvements, both fit on the 120 RAVDESS clips
(`data/timelines/ravdess_emotion_predictions.csv`):

**1. Valence/arousal calibration.** The audeering model skews systematically
negative and compresses its range. We fit an affine map (least squares) from
the model's raw output to canonical Russell V/A targets per emotion:

    valence_cal = clamp(1.9332 · v_raw + 0.5106)
    arousal_cal = clamp(1.0414 · a_raw + 0.0998)

After calibration neutral sits ≈ 0 (was −0.28) and anger reads clearly
negative (≈ −0.41). This fixes the "happy renders dark" demo bias at the
extremes.

**2. Hybrid category.** The visible channels (shape, hue) were category-driven
by the weak categorical head (~51% on RAVDESS, *never* predicted "sad").
`derive_category()` now fuses the categorical label with the calibrated V/A
(+ dominance to split anger vs fear), filling the gaps the categorical model
can't. Measured on RAVDESS (same 4-class scheme as above):

    categorical model alone : 50.8%
    hybrid (cat + V/A)      : 55.0%
    anger recall            : 100%
    sadness recall          : 0% → 38%   (categorical never predicted sad)

**Honest caveat.** This is a measured improvement, not a fix. *Positive*-valence
emotions (happy, surprised) remain weak because the dimensional model's valence
is poor there — some happy clips still read negative. The real remedy is
fine-tuning on an emotion corpus (incl. Korean) — see above. The calibration
coefficients are RAVDESS-derived and English; they are a documented stopgap.

## Text tie-breaker for valence (prosody-first)

The acoustic models are weak at *valence* (positive vs. negative) — a field-wide
"valence problem," since positivity lives more in words/faces than in sound.
Text is strong exactly there, so we use it as a **gated tie-breaker**:

- The voice (acoustic valence) is always primary.
- Text valence is consulted **only when the acoustic valence is near zero**
  (`|v| < 0.2`) — i.e. when the voice genuinely can't tell positive from
  negative. A *confident* tone is never overridden, so **sarcasm is preserved**
  (a clearly bitter "great" stays negative).

Verified behavior (`fuse_valence`):

| case | acoustic v | → fused v |
|---|---|---|
| uncertain voice + positive words (EN) | −0.05 | **+0.31** |
| uncertain voice + negative words (EN) | +0.05 | **−0.29** |
| confident negative tone + positive words (sarcasm, EN) | −0.55 | −0.55 (unchanged) |
| Korean (any) | −0.05 | −0.05 (gated off) |

**Per-language routing (English + Korean).** A single multilingual text model
mislabels clear Korean negatives as positive (e.g. "이건 정말 최악이야" → +0.42),
which would *corrupt* valence for our primary audience. So `text_sentiment.py`
routes each language to a model validated for it:

| lang | model | probe results |
|---|---|---|
| en | `lxyuan/distilbert-…-sentiments-student` | "so happy" → +0.97 ✓ |
| ko | `WhitePeak/bert-base-cased-Korean-sentiment` | "최악이야"→NEG ✓, "행복해요"→POS ✓, "슬프고 우울해"→NEG ✓ |

The Korean model was chosen by testing candidates on the exact sentences the
multilingual model failed; `matthewburke/korean_sentiment` was rejected (it
mislabeled "너무 슬프고 우울해" as positive). Korean fusion verified end-to-end:
uncertain + positive → +0.26, uncertain + negative → −0.32, confident negative
tone (sarcasm) → unchanged. `SOUNDSHAPE_TEXT_LANGS` default is now `en,ko`;
other languages remain a no-op until a validated model is added.

## Honest limitation statement (for the report)

> SoundShape's emotion models are trained on English affective speech. On
> Korean, transcription is validated and accurate; emotion is unvalidated and
> expected to be weaker, especially on valence. We evaluated a multilingual
> (XLSR) alternative, which did not load correctly on our toolchain and remained
> English-trained regardless. We therefore document Korean emotion as a known
> limitation and propose fine-tuning on AIHub/KEMDy as the next step, while
> noting that the prosody-driven component of the visualization is already
> language-independent.
