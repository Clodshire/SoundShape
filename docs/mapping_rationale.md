# Mapping Rationale — Why these shapes, colors, sizes, and motions?

> The most common challenge a judge will raise:
> *"Isn't this mapping arbitrary? Why is anger red and not green?"*
>
> This document answers that. Every rule is grounded in published research,
> and the rules live in a tunable spec at
> [`config/mapping_config.json`](../config/mapping_config.json), read
> identically by the Python backend and the TypeScript frontend (verified
> byte-for-byte identical on a parity grid).

---

## The model: two bridges, not one

SoundShape does **not** map sound directly to pictures. It crosses **two
bridges**, and we ground each one separately:

```
   AUDIO  ──bridge 1──▶  EMOTION  ──bridge 2──▶  VISUAL
 (prosody)             (valence,             (shape, color,
                        arousal,              size, motion)
                        category)
```

- **Bridge 1 — acoustic → emotion.** Pitch, intensity, jitter, etc. predict
  emotion. Grounded in Banse & Scherer (1996) and learned by wav2vec 2.0.
  (Implemented in `backend/pipeline/prosody.py` + `emotion.py`.)
- **Bridge 2 — emotion → visual.** An emotion's position in valence/arousal
  space, plus its category, selects a visual form. This document is about
  **bridge 2.**

Keeping the bridges separate is what lets us answer "why red?" with research
rather than taste.

---

## Emotion space — Russell's circumplex

We place every emotion on a 2-D plane (Russell, 1980):

- **Valence** — negative ↔ positive
- **Arousal** — calm ↔ excited

Each visual channel reads from this plane (and the discrete category):

| Channel | Driven by | One-line reason |
|---|---|---|
| **Shape** | category | angular = threat, round = warmth |
| **Color hue** | category | learned color-emotion associations |
| **Color saturation** | arousal | vivid = activated |
| **Color lightness** | valence | brighter = more pleasant |
| **Size** | arousal | bigger = more intense |
| **Motion** | arousal + category | jerky = agitated, smooth = calm |

> A note on **signed arousal.** Arousal runs from −1 (calm) to +1 (excited).
> Size and saturation map it **monotonically** via `(arousal+1)/2`, so a calm
> whisper is small and muted and a shout is large and vivid. (An earlier
> version used `|arousal|`, which wrongly made *very calm* states as large
> and saturated as excited ones — fixed in v1.1.)

---

## Channel 1 — Shape

**Rule:** angular/jagged forms for threatening, high-arousal-negative
emotions; rounded/flowing forms for warm, calm, or positive ones.

| Emotion | Shape |
|---|---|
| Anger | `jagged_star` |
| Fear | `trembling_spikes` |
| Joy / Surprise | `expanding_burst` |
| Sadness | `flowing_wave` |
| Resignation | `drooping_ellipse` |
| Sincerity | `soft_circle` |
| Neutral | `simple_circle` |

**Grounding (direct).** Aronoff et al. (1992) and Larson, Aronoff & Stearns
(2007) showed experimentally that **angular and downward-pointing shapes are
perceived as threatening**, while rounded shapes read as warm and safe — even
as abstract geometric figures. Bar & Neta (2006, 2007) found a **neural
basis**: sharp-contoured objects preferentially engage the **amygdala**, the
brain's threat detector, and people reliably *prefer* curved objects.

**Grounding (supporting).** The Bouba/Kiki effect (Köhler, 1929; Ramachandran
& Hubbard, 2001) shows the same angular↔harsh / round↔soft mapping runs
between *speech sounds* and shapes — evidence the correspondence is deep and
cross-modal, not learned convention.

> Citations: Aronoff et al. (1992); Larson et al. (2007); Bar & Neta (2006);
> Köhler (1929); Ramachandran & Hubbard (2001).

---

## Channel 2 — Color

**Rule:** hue is set by category; **saturation rises with arousal**;
**lightness rises with valence**.

```
saturation = clamp(30 + ((arousal+1)/2) × 60,  25, 95)   # calm→muted, excited→vivid
lightness  = clamp(50 + valence × 12,           35, 70)   # positive→lighter
```

| Emotion | Hue | Evidence strength |
|---|---|---|
| Anger | 0° red | **strong** — cross-cultural |
| Joy | 50° yellow | moderate |
| Surprise | 45° bright yellow | moderate |
| Sincerity | 80° yellow-green | moderate |
| Sarcasm | 200° cool blue | design choice |
| Sadness | 220° blue | **weak** (English idiom) |
| Resignation | 230° muted blue | design choice |
| Fear | 270° violet | **weak** (our choice) |
| Neutral | grey (s=0) | — |

**Grounding.** **Anger = red** is the one cross-culturally robust hue: Hupka
et al. (1997) found it across the US, Germany, Russia, Mexico, and Poland. The
other hues come from color-emotion norming studies (Kaya & Epps, 2004; Valdez
& Mehrabian, 1994). **Saturation ↔ arousal** and **lightness ↔ pleasure
(valence)** are direct findings of Valdez & Mehrabian (1994) and Wilms &
Oberfeld (2018): more saturated colors feel more arousing, brighter colors
feel more pleasant.

**Honesty flags.** *Sadness = blue* leans on the English idiom "feeling
blue"; cross-culturally Hupka found sadness/fear cluster on **black/grey**.
*Fear = violet* is our design choice, not a finding. These are exactly the
mappings to test with users (see Limitations).

> Citations: Hupka et al. (1997); Valdez & Mehrabian (1994); Wilms & Oberfeld
> (2018); Kaya & Epps (2004).

---

## Channel 3 — Size

**Rule:** size scales monotonically with arousal.

```
size = clamp(0.2 + ((arousal+1)/2) × 0.7,  0.2, 0.95)   # calm→small, excited→large
```

**Grounding.** Arousal is the *activation* axis of Russell's (1980)
circumplex; bigger forms are more visually salient, mirroring greater
activation. This channel also has a **linguistic** backbone unique to a
speech tool:

- **The Frequency Code (Ohala, 1994).** A cross-linguistic universal: **low
  pitch signals largeness, dominance, and threat; high pitch signals
  smallness, submission, and friendliness.** Because SoundShape measures F0
  directly, the frequency code gives a principled bridge from *pitch* to
  *visual size and threat* — independent of, and reinforcing, the arousal
  mapping.
- **Sound-magnitude symbolism (Sapir, 1929).** Vowels like /i/ feel "small,"
  /a/ feels "large" — early evidence that acoustic features map onto size.

> A future version can drive size *directly* from measured F0 via the
> frequency code, instead of routing through arousal. The prosody module
> already extracts F0.

> Citations: Russell (1980); Ohala (1994); Sapir (1929).

---

## Channel 4 — Motion

**Rule:** an ordered set of conditions on (category, valence, arousal);
first match wins.

| Condition | Motion |
|---|---|
| arousal > 0.4 **and** valence < 0 | `shake` |
| fear | `tremor` |
| arousal > 0.4 | `pulse` (strong) |
| sadness, arousal < −0.2, valence < 0 | `slow_drift` |
| resignation | `sink` |
| sincerity | `pulse` (gentle) |
| *(else)* | `still` |

**Grounding (direct).** Pollick et al. (2001) showed that the **kinematics of
movement carry emotion**: fast, jerky motion reads as anger / high arousal;
slow, smooth motion reads as sadness / low arousal — measured from arm
movements stripped of all other cues. We render high-arousal-negative emotion
as literal *shaking* and low-arousal emotion as *slow drift / sinking*.

**Grounding (supporting).** Spence's (2011) crossmodal review documents the
general rule that *fast sound ↔ fast motion*. And the acoustic instability we
imitate — micro-tremor in pitch (jitter) and loudness (shimmer) during hot
anger and panic fear — is from Banse & Scherer's (1996) acoustic profiles.

> Citations: Pollick et al. (2001); Spence (2011); Banse & Scherer (1996).

---

## Limitations & cultural validity

Honesty about what is *not* settled — and why SoundShape's user testing
matters:

1. **Color-emotion is partly cultural.** Anger=red is robust, but sadness=blue
   is an English-language idiom and fear=violet is our choice. In parts of
   East Asia white signals mourning. Because our target users are **Korean
   deaf and hard-of-hearing people**, these mappings must be validated with
   Korean participants, not assumed (Phase 8).
2. **Is emotional prosody universal?** Pell et al. (2009) found vocal emotion
   is recognized across languages but **above-chance, not perfectly** — accuracy
   drops across language boundaries. So bridge 1 (acoustic→emotion) may need
   Korean-specific calibration.
3. **Categorical vs dimensional emotion is a live debate.** We pragmatically
   hybridize Ekman's basic categories (shape, hue) with Russell's continuous
   dimensions (size, saturation, motion). Constructionist accounts (Lindquist
   et al., 2012; Barrett, 2017) argue dimensions are more fundamental — a
   reason to keep the continuous channels central.
4. **Some constants are tuned, not derived.** The exact coefficients in the
   color/size formulas set *magnitude*; research fixes their *direction*. They
   are meant to be calibrated against user testing, which is why they live in
   an editable config.

Every limitation above is a concrete, testable hypothesis — which is the
point. SoundShape's mapping is a *falsifiable* design, not decoration.

---

## How to tune it

Edit [`config/mapping_config.json`](../config/mapping_config.json), then run:

```bash
python scripts/sync_mapping_config.py
```

Both engines (Python backend, TypeScript frontend) read the same spec, so they
can never disagree — A/B experiments are a one-file change.

---

## Full reference list

- **Aronoff, J., Woike, B. A., & Hyman, L. M. (1992).** Which are the stimulus
  features of facial threat? *Journal of Personality and Social Psychology,
  62*(6), 1050–1066.
- **Banse, R., & Scherer, K. R. (1996).** Acoustic profiles in vocal emotion
  expression. *Journal of Personality and Social Psychology, 70*(3), 614–636.
- **Bar, M., & Neta, M. (2006).** Humans prefer curved visual objects.
  *Psychological Science, 17*(8), 645–648.
- **Bar, M., & Neta, M. (2007).** Visual elements of subjective preference
  modulate amygdala activation. *Neuropsychologia, 45*(10), 2191–2200.
- **Barrett, L. F. (2017).** The theory of constructed emotion. *Social
  Cognitive and Affective Neuroscience, 12*(1), 1–23.
- **Gussenhoven, C. (2002).** Intonation and interpretation: phonetics and
  phonology. *Speech Prosody 2002.*
- **Hupka, R. B., Zaleski, Z., Otto, J., Reidl, L., & Tarabrina, N. V.
  (1997).** The colors of anger, envy, fear, and jealousy: A cross-cultural
  study. *Journal of Cross-Cultural Psychology, 28*(2), 156–171.
- **Kaya, N., & Epps, H. H. (2004).** Relationship between color and emotion.
  *College Student Journal, 38*(3), 396–405.
- **Köhler, W. (1929).** *Gestalt Psychology.* Liveright.
- **Larson, C. L., Aronoff, J., & Stearns, J. J. (2007).** The shape of
  threat: simple geometric forms evoke rapid and sustained capture of
  attention. *Emotion, 7*(3), 526–534.
- **Lindquist, K. A., Wager, T. D., Kober, H., Bliss-Moreau, E., & Barrett, L.
  F. (2012).** The brain basis of emotion: A meta-analytic review. *Behavioral
  and Brain Sciences, 35*(3), 121–143.
- **Ohala, J. J. (1994).** The frequency code underlies the sound-symbolic use
  of voice pitch. In Hinton, Nichols, & Ohala (Eds.), *Sound Symbolism*
  (pp. 325–347). Cambridge University Press.
- **Pell, M. D., Monetta, L., Paulmann, S., & Kotz, S. A. (2009).**
  Recognizing emotions in a foreign language. *Journal of Nonverbal Behavior,
  33*(2), 107–120.
- **Pollick, F. E., Paterson, H. M., Bruderlin, A., & Sanford, A. J. (2001).**
  Perceiving affect from arm movement. *Cognition, 82*(2), B51–B61.
- **Ramachandran, V. S., & Hubbard, E. M. (2001).** Synaesthesia — A window
  into perception, thought and language. *Journal of Consciousness Studies,
  8*(12), 3–34.
- **Russell, J. A. (1980).** A circumplex model of affect. *Journal of
  Personality and Social Psychology, 39*(6), 1161–1178.
- **Sapir, E. (1929).** A study in phonetic symbolism. *Journal of
  Experimental Psychology, 12*(3), 225–239.
- **Spence, C. (2011).** Crossmodal correspondences: A tutorial review.
  *Attention, Perception, & Psychophysics, 73*(4), 971–995.
- **Valdez, P., & Mehrabian, A. (1994).** Effects of color on emotions.
  *Journal of Experimental Psychology: General, 123*(4), 394–409.
- **Wilms, L., & Oberfeld, D. (2018).** Color and emotion: effects of hue,
  saturation, and brightness. *Psychological Research, 82*(5), 896–914.
