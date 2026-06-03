"""Audio I/O + prosody: real clip, silent clip, and corrupt-file failure.

These use Parselmouth + FFmpeg only (no ML models), so they're fast.
"""

from __future__ import annotations

import math

import pytest

from backend.pipeline import audio_io
from backend.pipeline.prosody import extract_prosody


def _all_finite(d: dict) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in d.values())


def test_prosody_on_real_clip(sample_wav):
    feats = extract_prosody(str(sample_wav)).features.to_dict()
    assert _all_finite(feats)
    assert feats["duration"] > 0
    assert feats["f0_mean"] > 0  # voiced speech has pitch


def test_prosody_on_silence_does_not_crash(silent_wav):
    """Silent input must return finite numbers (zeros), never NaN/crash."""
    feats = extract_prosody(str(silent_wav)).features.to_dict()
    assert _all_finite(feats)


def test_normalize_produces_16k_mono(sample_wav, tmp_path):
    res = audio_io.normalize_to_wav(sample_wav, out_dir=tmp_path)
    assert res.sample_rate == 16000
    assert res.duration > 0
    assert res.path.exists()


def test_corrupt_file_rejected_cleanly(corrupt_file, tmp_path):
    """A non-audio file should raise (handled), not hang or segfault."""
    with pytest.raises(Exception):
        audio_io.normalize_to_wav(corrupt_file, out_dir=tmp_path)


def test_slice_bad_bounds_raises(sample_wav):
    with pytest.raises(ValueError):
        audio_io.slice_to_temp_wav(sample_wav, 5.0, 1.0)  # end < start
