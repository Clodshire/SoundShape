"""Silence-aligned chunker: boundaries, short first chunk, edge sizes."""

from __future__ import annotations

import wave

import numpy as np

from backend.pipeline.chunker import find_chunk_boundaries


def _write(path, seconds, sr=16000, silent=False):
    n = int(sr * seconds)
    if silent:
        sig = np.zeros(n, dtype=np.int16)
    else:
        t = np.arange(n) / sr
        sig = (np.sin(2 * np.pi * 200 * t) * 8000).astype(np.int16)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(sig.tobytes())


def test_short_clip_one_chunk(tmp_path):
    p = tmp_path / "short.wav"
    _write(p, 5)
    bounds = find_chunk_boundaries(p)
    assert len(bounds) == 1
    assert bounds[0][0] == 0.0


def test_boundaries_cover_and_are_ordered(tmp_path):
    p = tmp_path / "long.wav"
    _write(p, 60)
    bounds = find_chunk_boundaries(p)
    assert bounds[0][0] == 0.0
    # contiguous + increasing
    for (s, e), (s2, _) in zip(bounds, bounds[1:]):
        assert e > s
        assert abs(s2 - e) < 1e-6
    assert bounds[-1][1] > 50  # covers the whole clip


def test_no_chunk_exceeds_hard_cap(tmp_path):
    p = tmp_path / "tone.wav"
    _write(p, 120)  # continuous tone, no silence → forces hard-cap cuts
    bounds = find_chunk_boundaries(p, hard_cap_sec=40.0)
    assert all((e - s) <= 40.0 + 1e-6 for s, e in bounds)
