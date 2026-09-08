"""Trained-classifier integration: bundle integrity, label mapping, fallback.

These check the contract between training and serving without running any
neural network — the expensive part (embedding backbone) is never touched.
The point is to catch the class of bug that silently degrades quality: a
label the runtime can't map, a feature vector whose width no longer matches
what the model was fitted on, or an artifact that stops loading.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.pipeline import trained_classifier as tc

REPO = Path(__file__).resolve().parent.parent.parent
CONFIG = REPO / "config" / "mapping_config.json"


def _bundles():
    found = []
    for lang, filename in tc.BUNDLES.items():
        bundle = tc._load_bundle(filename)
        if bundle is not None:
            found.append((lang, bundle))
    return found


def test_at_least_one_bundle_present():
    """The runtime classifiers should be built (build_runtime_classifiers.py)."""
    assert _bundles(), (
        "no trained classifier found — run scripts/build_runtime_classifiers.py"
    )


def test_every_trained_label_is_mappable():
    """Any class the model can emit must have a category mapping.

    Without this an unseen label silently becomes 'neutral' and the emotion
    is lost rather than shown wrong — the quiet failure mode.
    """
    for lang, bundle in _bundles():
        for label in bundle["classes"]:
            assert label in tc.LABEL_TO_CATEGORY, (
                f"[{lang}] label {label!r} has no entry in LABEL_TO_CATEGORY"
            )


def test_mapped_categories_exist_in_mapping_config():
    """Mapped categories must be renderable by the shared mapping config."""
    cfg = json.loads(CONFIG.read_text())
    known = set(cfg["shape"]["by_category"]) | {cfg["shape"]["default"]}
    for lang, bundle in _bundles():
        for label in bundle["classes"]:
            category = tc.LABEL_TO_CATEGORY[label]
            assert category in known, (
                f"[{lang}] {label!r} → {category!r} is not in mapping_config"
            )


def test_feature_width_matches_fitted_model():
    """emb_dim + prosody count must equal what the pipeline was fitted on."""
    for lang, bundle in _bundles():
        expected = bundle["emb_dim"] + len(bundle["prosody_keys"])
        fitted = bundle["pipeline"].named_steps["scale"].n_features_in_
        assert fitted == expected, (
            f"[{lang}] model expects {fitted} features, "
            f"metadata describes {expected}"
        )


def test_prosody_keys_are_real_features():
    """Every prosody key must exist on the extractor's output."""
    from backend.pipeline.prosody import ProsodyFeatures
    import dataclasses

    available = {f.name for f in dataclasses.fields(ProsodyFeatures)}
    for lang, bundle in _bundles():
        for key in bundle["prosody_keys"]:
            assert key in available, f"[{lang}] unknown prosody key {key!r}"


def test_korean_bundle_uses_korean_embedding():
    """Korean must route to the Korean-specialised embedding, not the English one.

    This is the whole point of the embedding-swap result (43.6% → 49.6%);
    if it regresses to audeering the gain silently disappears.
    """
    bundle = tc._load_bundle(tc.BUNDLES["ko"])
    if bundle is None:
        pytest.skip("Korean classifier not built")
    assert "xlsr" in bundle["embedding_model"].lower()


def test_disabled_returns_none(monkeypatch):
    """The kill switch must cleanly fall back to the zero-shot head."""
    monkeypatch.setattr(tc, "ENABLED", False)
    assert tc.classify_trained("nonexistent.wav", "en") is None


def test_missing_audio_degrades_gracefully():
    """A bad path must return None, never raise into the pipeline."""
    assert tc.classify_trained("/nonexistent/does_not_exist.wav", "en") is None


def test_unknown_language_falls_back_to_default_bundle():
    """An unlisted language should still resolve to a usable bundle."""
    assert tc.BUNDLES.get("xx", tc.DEFAULT_BUNDLE) == tc.DEFAULT_BUNDLE
