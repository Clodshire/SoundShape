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

## Honest limitation statement (for the report)

> SoundShape's emotion models are trained on English affective speech. On
> Korean, transcription is validated and accurate; emotion is unvalidated and
> expected to be weaker, especially on valence. We evaluated a multilingual
> (XLSR) alternative, which did not load correctly on our toolchain and remained
> English-trained regardless. We therefore document Korean emotion as a known
> limitation and propose fine-tuning on AIHub/KEMDy as the next step, while
> noting that the prosody-driven component of the visualization is already
> language-independent.
