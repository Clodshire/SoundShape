"""Extract prosodic features from a speech audio file.

Uses Parselmouth (the Python binding for PRAAT) to compute the standard
prosodic feature set used in voice emotion research:

  F0 (pitch)        — pitch height and variability
  Intensity         — loudness
  Jitter / Shimmer  — micro-perturbations in pitch / amplitude
                      (correlate with strain, fear, age, emotion)
  HNR               — harmonics-to-noise ratio (voice clarity)
  Speech rate       — voiced frames per second (rough syllable proxy)
  Voiced ratio      — proportion of frames classified as voiced

These features are *interpretable* (each has a known acoustic meaning) and
*standard* (used in the emotion-recognition literature for decades). They
complement wav2vec2's opaque deep embeddings — together they form the
dual analysis described in docs/02_TECHSTACK.md §"Layer 3 + Layer 4".

Citations
  Boersma 2001         — PRAAT, a system for doing phonetics by computer
  Jadoul et al. 2018   — Parselmouth: A Python interface to PRAAT
  Banse & Scherer 1996 — Acoustic profiles in vocal emotion expression
  Juslin & Laukka 2003 — Communication of emotions in vocal expression
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, List

import numpy as np
import parselmouth
from parselmouth.praat import call

# Reasonable pitch search range for typical adult speech.
# Children, falsetto, or synthesized voices may need higher ceiling.
DEFAULT_PITCH_FLOOR = 75.0
DEFAULT_PITCH_CEILING = 600.0


@dataclass
class ProsodyFeatures:
    """Scalar summary of prosodic features over the whole sound or segment."""

    duration: float
    f0_mean: float
    f0_std: float
    f0_min: float
    f0_max: float
    f0_range: float
    intensity_mean: float
    intensity_std: float
    intensity_min: float
    intensity_max: float
    jitter_local: float
    shimmer_local: float
    hnr_mean: float
    voiced_ratio: float
    speech_rate_approx: float

    def to_dict(self) -> Dict[str, float]:
        return asdict(self)


@dataclass
class ProsodyResult:
    """Full result: summary features + time-series curves for plotting."""

    features: ProsodyFeatures
    f0_times: List[float]
    f0_curve: List[float]
    intensity_times: List[float]
    intensity_curve: List[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "features": self.features.to_dict(),
            "f0_times": self.f0_times,
            "f0_curve": self.f0_curve,
            "intensity_times": self.intensity_times,
            "intensity_curve": self.intensity_curve,
        }


def extract_prosody(
    wav_path: str,
    pitch_floor: float = DEFAULT_PITCH_FLOOR,
    pitch_ceiling: float = DEFAULT_PITCH_CEILING,
) -> ProsodyResult:
    """Extract a full prosody feature set from a WAV file.

    Args:
        wav_path: Path to a mono PCM WAV (16 kHz is ideal; other rates work).
        pitch_floor: Lower bound for pitch detection (Hz). 75 = adult speech.
        pitch_ceiling: Upper bound (Hz). Raise to ~800 for high voices.
    """
    snd = parselmouth.Sound(wav_path)
    duration = float(snd.duration)

    # --- F0 (pitch) ---
    pitch = snd.to_pitch(pitch_floor=pitch_floor, pitch_ceiling=pitch_ceiling)
    f0_values = pitch.selected_array["frequency"]
    f0_times = [float(t) for t in pitch.xs()]
    voiced_mask = f0_values > 0
    voiced_f0 = f0_values[voiced_mask]

    if voiced_f0.size > 0:
        f0_mean = float(voiced_f0.mean())
        f0_std = float(voiced_f0.std())
        f0_min = float(voiced_f0.min())
        f0_max = float(voiced_f0.max())
    else:
        f0_mean = f0_std = f0_min = f0_max = 0.0

    voiced_ratio = float(voiced_mask.mean()) if voiced_mask.size else 0.0
    speech_rate_approx = (
        float(voiced_mask.sum()) / duration if duration > 0 else 0.0
    )

    # --- Intensity ---
    intensity = snd.to_intensity()
    intensity_values = np.asarray(intensity.values).flatten()
    intensity_times = [float(t) for t in intensity.xs()]
    if intensity_values.size:
        intensity_mean = float(intensity_values.mean())
        intensity_std = float(intensity_values.std())
        intensity_min = float(intensity_values.min())
        intensity_max = float(intensity_values.max())
    else:
        intensity_mean = intensity_std = intensity_min = intensity_max = 0.0

    # --- Jitter & shimmer ---
    # Both need a PointProcess of glottal pulses extracted from voiced segments.
    try:
        point_process = call(
            snd,
            "To PointProcess (periodic, cc)",
            pitch_floor,
            pitch_ceiling,
        )
        jitter_local = float(
            call(point_process, "Get jitter (local)", 0, 0, 0.0001, 0.02, 1.3)
        )
        shimmer_local = float(
            call(
                [snd, point_process],
                "Get shimmer (local)",
                0,
                0,
                0.0001,
                0.02,
                1.3,
                1.6,
            )
        )
        if not np.isfinite(jitter_local):
            jitter_local = 0.0
        if not np.isfinite(shimmer_local):
            shimmer_local = 0.0
    except parselmouth.PraatError:
        # Silent / un-pitched audio raises PraatError when computing pulses.
        jitter_local = 0.0
        shimmer_local = 0.0

    # --- HNR ---
    try:
        harmonicity = snd.to_harmonicity()
        hnr_mean = float(call(harmonicity, "Get mean", 0, 0))
        if not np.isfinite(hnr_mean):
            hnr_mean = 0.0
    except parselmouth.PraatError:
        hnr_mean = 0.0

    features = ProsodyFeatures(
        duration=duration,
        f0_mean=f0_mean,
        f0_std=f0_std,
        f0_min=f0_min,
        f0_max=f0_max,
        f0_range=f0_max - f0_min,
        intensity_mean=intensity_mean,
        intensity_std=intensity_std,
        intensity_min=intensity_min,
        intensity_max=intensity_max,
        jitter_local=jitter_local,
        shimmer_local=shimmer_local,
        hnr_mean=hnr_mean,
        voiced_ratio=voiced_ratio,
        speech_rate_approx=speech_rate_approx,
    )

    return ProsodyResult(
        features=features,
        f0_times=f0_times,
        f0_curve=[float(v) for v in f0_values],
        intensity_times=intensity_times,
        intensity_curve=[float(v) for v in intensity_values],
    )


if __name__ == "__main__":
    import sys
    from pprint import pprint

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.prosody <wav_path>")
        sys.exit(1)

    result = extract_prosody(sys.argv[1])
    pprint(result.features.to_dict())
