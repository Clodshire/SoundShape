"""RAVDESS filename parsing."""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.pipeline.datasets import parse_ravdess_filename


def test_parse_angry_male():
    c = parse_ravdess_filename(Path("Actor_01/03-01-05-02-01-01-01.wav"))
    assert c.emotion == "angry"
    assert c.intensity == "strong"
    assert c.actor == "01"
    assert c.actor_sex == "male"


def test_parse_even_actor_is_female():
    c = parse_ravdess_filename(Path("Actor_02/03-01-04-01-02-02-02.wav"))
    assert c.actor_sex == "female"
    assert c.emotion == "sad"
    assert c.statement.startswith("Dogs")


def test_bad_filename_raises():
    with pytest.raises(ValueError):
        parse_ravdess_filename(Path("not-ravdess.wav"))
