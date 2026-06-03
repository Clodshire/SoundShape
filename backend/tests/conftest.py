"""Shared pytest fixtures + path setup."""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))


@pytest.fixture(scope="session")
def repo() -> Path:
    return REPO


@pytest.fixture(scope="session")
def sample_wav() -> Path:
    """The committed 16 kHz mono test clip."""
    p = REPO / "data" / "samples" / "test.wav"
    if not p.exists():
        pytest.skip("data/samples/test.wav missing")
    return p


@pytest.fixture(scope="session")
def silent_wav(tmp_path_factory) -> Path:
    """A 2 s silent 16 kHz mono WAV (failure-case input)."""
    p = tmp_path_factory.mktemp("audio") / "silent.wav"
    sr = 16000
    data = np.zeros(sr * 2, dtype=np.int16)
    with wave.open(str(p), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())
    return p


@pytest.fixture(scope="session")
def corrupt_file(tmp_path_factory) -> Path:
    """A non-audio file with a .wav name (should be rejected cleanly)."""
    p = tmp_path_factory.mktemp("bad") / "broken.wav"
    p.write_bytes(b"this is not audio data " * 50)
    return p
