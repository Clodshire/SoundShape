"""Mapping engine: structure, research-grounded rules, prosody, confidence."""

from __future__ import annotations

import pytest

from backend.mapping.engine import map_emotion_to_visual


def _emotion(cat, v, a, **kw):
    return {"category": cat, "valence": v, "arousal": a, **kw}


def test_output_structure():
    vis = map_emotion_to_visual(_emotion("joy", 0.6, 0.5))
    assert set(vis) == {"shape", "color", "size", "motion"}
    assert set(vis["color"]) == {"h", "s", "l"}
    assert set(vis["motion"]) == {"type", "amplitude", "speed"}


def test_ranges_clamped():
    for cat, v, a in [("anger", -1, 1), ("joy", 1, 1), ("sadness", -1, -1)]:
        vis = map_emotion_to_visual(_emotion(cat, v, a))
        assert 0.0 <= vis["size"] <= 1.0
        assert 0 <= vis["color"]["s"] <= 100
        assert 35 <= vis["color"]["l"] <= 70


def test_grounded_rules():
    # anger → red, jagged, agitated
    a = map_emotion_to_visual(_emotion("anger", -0.7, 0.85))
    assert a["shape"] == "jagged_star"
    assert a["color"]["h"] == 0
    assert a["motion"]["type"] == "shake"
    # sadness → blue, flowing
    s = map_emotion_to_visual(_emotion("sadness", -0.55, -0.35))
    assert s["shape"] == "flowing_wave"
    assert s["color"]["h"] == 220
    # neutral → grey (no saturation)
    n = map_emotion_to_visual(_emotion("neutral", 0.0, 0.0))
    assert n["color"]["s"] == 0


def test_arousal_monotonic_size():
    """Calm → small, excited → large (the |arousal| bug must stay fixed)."""
    calm = map_emotion_to_visual(_emotion("joy", 0.5, -0.9))["size"]
    excited = map_emotion_to_visual(_emotion("joy", 0.5, 0.9))["size"]
    assert calm < excited


def test_prosody_increases_instability():
    base = _emotion("anger", -0.7, 0.85)
    calm_pros = {"jitter_local": 0.005, "shimmer_local": 0.03,
                 "intensity_mean": 50, "speech_rate_approx": 25}
    shaky_pros = {"jitter_local": 0.04, "shimmer_local": 0.15,
                  "intensity_mean": 78, "speech_rate_approx": 85}
    amp_calm = map_emotion_to_visual(base, calm_pros)["motion"]["amplitude"]
    amp_shaky = map_emotion_to_visual(base, shaky_pros)["motion"]["amplitude"]
    assert amp_shaky > amp_calm  # measured jitter/shimmer drive the motion


def test_confidence_attenuates():
    """Low confidence → muted (less saturation), smaller, calmer."""
    sure = map_emotion_to_visual(_emotion("anger", -0.7, 0.85, category_confidence=0.95))
    unsure = map_emotion_to_visual(_emotion("anger", -0.7, 0.85, category_confidence=0.45))
    assert unsure["color"]["s"] < sure["color"]["s"]
    assert unsure["size"] < sure["size"]
    assert unsure["motion"]["amplitude"] < sure["motion"]["amplitude"]


def test_deterministic():
    e = _emotion("fear", -0.5, 0.5, category_confidence=0.7)
    assert map_emotion_to_visual(e) == map_emotion_to_visual(e)
