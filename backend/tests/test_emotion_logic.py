"""Pure emotion logic: calibration, hybrid category, text-fusion gating.

These don't load ML models (they exercise the decision logic only), so they run
fast. Model-dependent inference is covered by the curl/integration checks.
"""

from __future__ import annotations

from backend.pipeline.emotion import (
    _calibrate,
    derive_category,
    fuse_valence,
    VALENCE_CALIB,
)


def test_calibrate_clamps():
    assert -1.0 <= _calibrate(10.0, VALENCE_CALIB) <= 1.0
    assert -1.0 <= _calibrate(-10.0, VALENCE_CALIB) <= 1.0


def test_derive_category_quadrants():
    # low arousal + negative valence → sadness
    assert derive_category("neu", -0.4, -0.3, 0.0) == "sadness"
    # high arousal + negative + dominant → anger; submissive → fear
    assert derive_category("ang", -0.4, 0.6, 0.5) == "anger"
    assert derive_category("ang", -0.4, 0.6, -0.5) == "fear"
    # positive + aroused → joy
    assert derive_category("hap", 0.4, 0.4, 0.0) == "joy"
    # near origin → neutral
    assert derive_category("neu", 0.0, 0.0, 0.0) == "neutral"


def test_fusion_sarcasm_safe():
    """A confident negative tone is never overridden by positive words."""
    assert fuse_valence(-0.55, "what a wonderful day", "en") == -0.55


def test_fusion_language_gated():
    """Unsupported language → text is ignored (no corruption)."""
    assert fuse_valence(-0.05, "this is great", "xx") == -0.05


def test_fusion_disabled_when_no_text():
    assert fuse_valence(-0.05, None, "en") == -0.05
    assert fuse_valence(-0.05, "", "en") == -0.05
