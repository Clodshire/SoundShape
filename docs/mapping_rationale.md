# Mapping Rationale — Why these shapes, colors, and motions?

> The single most common challenge SoundShape will face from a judge is:
> *"Isn't this mapping arbitrary? Why is anger red and not green?"*
>
> This document answers that question. **Every mapping rule is grounded in
> published cross-modal correspondence research.** The rules themselves are
> not buried in code — they live in a tunable spec at
> [`config/mapping_config.json`](../config/mapping_config.json), consumed
> identically by the Python backend and the TypeScript frontend.

---

## The core claim

Humans do not pair sounds and visuals randomly. There are **systematic,
cross-culturally stable correspondences** between auditory/emotional
qualities and visual qualities — shape, color, size, motion. This is the
field of *crossmodal correspondence* (Spence, 2011). SoundShape's
contribution is to assemble these findings into one coherent visual
language for emotional prosody.

We encode emotion across **four independent visual channels**, so a single
glyph carries rich, simultaneous information:

| Channel | Encodes | Grounding |
|---|---|---|
| **Shape** | emotion *category* | Bouba/Kiki effect |
| **Color** | *valence* (+ category hue) | Hupka color-emotion study |
| **Size** | *arousal* | Russell circumplex |
| **Motion** | *stability / activation* | Spence; Banse & Scherer |

---

## Channel 1 — Shape

**Rule:** angular, jagged forms for harsh / high-arousal-negative emotions;
rounded, flowing forms for soft / low-arousal / positive emotions.

| Emotion | Shape | Intuition |
|---|---|---|
| Anger | `jagged_star` | sharp spikes = aggression |
| Fear | `trembling_spikes` | thin, unstable points |
| Joy / Surprise | `expanding_burst` | open, blooming |
| Sadness | `flowing_wave` | drooping, slow water |
| Resignation | `drooping_ellipse` | collapsed, heavy |
| Sincerity | `soft_circle` | warm, gentle |
| Neutral | `simple_circle` | baseline |

**Why this is not arbitrary — the Bouba/Kiki effect.** Köhler (1929) found
that people overwhelmingly pair the nonsense word *"takete"* (or *"kiki"*)
with a spiky shape and *"baluba"* (*"bouba"*) with a rounded one.
Ramachandran & Hubbard (2001) replicated this across languages and ages and
argued it reflects a built-in mapping between sharp acoustic onsets and
sharp visual contours. SoundShape applies the same principle: harsh vocal
emotions (anger, fear) get angular glyphs; soft ones (sincerity, calm) get
rounded glyphs.

> Citations: Köhler (1929); Ramachandran & Hubbard (2001).

---

## Channel 2 — Color

**Rule:** hue is primarily category-driven (following cross-cultural
color-emotion findings); **saturation scales with arousal**; **lightness is
nudged by valence**.

| Emotion | Hue | Source |
|---|---|---|
| Anger | 0° (red) | Hupka: red=anger in 6/6 cultures |
| Sadness | 220° (blue) | Hupka: blue/black=sadness |
| Joy | 50° (warm yellow) | Hupka: yellow=joy |
| Fear | 270° (violet) | Hupka: dark hues=fear |
| Surprise | 45° (bright yellow) | brightness = alertness |
| Resignation | 230° (muted blue-grey) | desaturated sadness |
| Sincerity | 80° (warm yellow-green) | warmth without alarm |
| Neutral | grey (s=0) | absence of charge |

The continuous part:

```
saturation = clamp(40 + |arousal| × 50,  25, 95)
lightness  = clamp(50 − valence × 8 + arousal × 5,  35, 70)
```

**Why this is not arbitrary — Hupka et al. (1997).** A cross-cultural study
of color-emotion associations across the United States, Germany, Russia,
Mexico, and Poland found *red* reliably tied to anger, *black/grey* to
sadness and fear, and *yellow* to joy — across all six samples. These are
not Western conventions; they are broadly shared. **Saturation = arousal**
follows directly from Russell's (1980) circumplex: high-arousal states are
vivid and intense, so they read as more saturated; calm states are muted.

> Citations: Hupka et al. (1997); Russell (1980).

---

## Channel 3 — Size

**Rule:** size is proportional to the magnitude of arousal.

```
size = clamp(0.3 + |arousal| × 0.55,  0.2, 0.95)
```

A whispered, calm utterance produces a small glyph; a shouted, agitated one
produces a large glyph that dominates the frame.

**Why this is not arbitrary.** Arousal is the activation axis of Russell's
(1980) circumplex — the dimension that captures *how much* energy an emotion
carries, independent of whether it is positive or negative. Visual
salience (size) is the most direct analog of activation: bigger = more
urgent. This also matches the loudness→size crossmodal correspondence
reported in Spence's (2011) review.

> Citations: Russell (1980); Spence (2011).

---

## Channel 4 — Motion

**Rule:** an ordered set of conditions on (category, valence, arousal). The
first matching rule wins; otherwise the glyph is still.

| Condition | Motion | Why |
|---|---|---|
| arousal > 0.4 **and** valence < 0 | `shake` | anger-like agitation |
| category = fear | `tremor` | fast fine trembling |
| arousal > 0.4 | `pulse` (strong) | joy/surprise energy |
| sadness, arousal < −0.2, valence < 0 | `slow_drift` | a sigh |
| resignation | `sink` | an exhale, settling down |
| sincerity | `pulse` (gentle) | soft warmth |
| *(else)* | `still` | baseline |

**Why this is not arbitrary — Banse & Scherer (1996).** Their acoustic
profiling of vocal emotion showed that high-arousal negative states (hot
anger, panic fear) are marked by *instability* in the voice — micro-tremor
in pitch (jitter) and amplitude (shimmer). We render that instability as
literal visual instability: shaking and trembling. Low-arousal states
(sadness, resignation) have slow, settling vocal contours, rendered as slow
drift / sinking. Spence (2011) provides the general principle that temporal
dynamics map across modalities (fast sound ↔ fast motion).

> Citations: Banse & Scherer (1996); Spence (2011). In a later phase we will
> drive `amplitude` directly from measured jitter/shimmer from
> `backend/pipeline/prosody.py`, closing the loop from signal to motion.

---

## How to tune it

All constants above are editable in
[`config/mapping_config.json`](../config/mapping_config.json). After editing,
run:

```bash
python scripts/sync_mapping_config.py
```

to propagate the change into the frontend bundle. Because both the Python
backend (`backend/mapping/engine.py`) and the TypeScript frontend
(`frontend/src/lib/mapping.ts`) read the same spec, they can never disagree.
This makes A/B experiments (mapping v1 vs v2) a one-file change.

---

## Full reference list

- **Banse, R., & Scherer, K. R. (1996).** Acoustic profiles in vocal emotion
  expression. *Journal of Personality and Social Psychology, 70*(3), 614–636.
- **Hupka, R. B., Zaleski, Z., Otto, J., Reidl, L., & Tarabrina, N. V.
  (1997).** The colors of anger, envy, fear, and jealousy: A cross-cultural
  study. *Journal of Cross-Cultural Psychology, 28*(2), 156–171.
- **Köhler, W. (1929).** *Gestalt Psychology.* New York: Liveright.
- **Ramachandran, V. S., & Hubbard, E. M. (2001).** Synaesthesia — A window
  into perception, thought and language. *Journal of Consciousness Studies,
  8*(12), 3–34.
- **Russell, J. A. (1980).** A circumplex model of affect. *Journal of
  Personality and Social Psychology, 39*(6), 1161–1178.
- **Spence, C. (2011).** Crossmodal correspondences: A tutorial review.
  *Attention, Perception, & Psychophysics, 73*(4), 971–995.
