"""Feedback store: thresholds, round-trip integrity, quality filtering, retention.

These run against a temporary store so they never touch collected data.
No models are loaded — this covers the storage contract only.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend.pipeline import feedback as fb


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Point the module at a throwaway store with a known config."""
    cfg = {
        "enabled": True,
        "trigger_below": 0.45,
        "display_seconds": 8,
        "min_interval_seconds": 120,
        "max_prompts_per_video": 5,
        "min_response_ms": 800,
        "question": "이 장면, 어떻게 느껴졌나요?",
        "options": [{"value": "angry", "label": "분노"},
                    {"value": "sadness", "label": "슬픔"}],
        "unsure_value": "unsure",
        "unsure_label": "모르겠음",
        "holdout_labels": ["sarcasm"],
        "holdout_min_count": 30,
        "max_pending": 100,
        "pending_ttl_days": 30,
    }
    cfg_path = tmp_path / "feedback_config.json"
    cfg_path.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(fb, "CONFIG_PATH", cfg_path)
    monkeypatch.setattr(fb, "STORE_DIR", tmp_path)
    monkeypatch.setattr(fb, "PENDING", tmp_path / "pending.jsonl")
    monkeypatch.setattr(fb, "LABELS", tmp_path / "labels.jsonl")
    return tmp_path


def _features(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.random(1038).astype(np.float32)


def test_asks_only_when_uncertain(store):
    assert fb.should_ask(0.30) is True
    assert fb.should_ask(0.44) is True
    assert fb.should_ask(0.45) is False   # threshold is exclusive
    assert fb.should_ask(0.90) is False


def test_disabled_config_never_asks(store, monkeypatch):
    cfg = json.loads(fb.CONFIG_PATH.read_text())
    cfg["enabled"] = False
    fb.CONFIG_PATH.write_text(json.dumps(cfg), encoding="utf-8")
    assert fb.should_ask(0.10) is False
    assert fb.register_pending(_features(), "neutral", 0.10) is None


def test_features_survive_round_trip_exactly(store):
    """Training data must be bit-identical to what the model actually scored."""
    original = _features(42)
    fid = fb.register_pending(original, "neutral", 0.3, language="ko")
    assert fid and fid.startswith("fb_")
    fb.record_label(fid, "angry", response_ms=1500)
    X, y, _ = fb.load_training_pairs()
    assert X.shape == (1, 1038)
    assert np.array_equal(X[0], original)
    assert y[0] == "angry"


def test_audio_is_never_stored(store):
    """The record may contain features and context — never a waveform."""
    fid = fb.register_pending(_features(), "neutral", 0.3,
                              context={"text": "안녕", "t": 1.0})
    record = json.loads((store / "pending.jsonl").read_text().strip())
    assert set(record) <= {
        "id", "created", "predicted", "confidence", "language",
        "embedding_model", "features", "source", "t", "duration", "text",
    }
    assert isinstance(record["features"], str)  # base64, not raw audio


def test_unknown_id_is_rejected(store):
    assert fb.record_label("fb_does_not_exist", "angry", 1500) is False


def test_unsure_and_careless_answers_are_dropped(store):
    keep = fb.register_pending(_features(1), "neutral", 0.3)
    unsure = fb.register_pending(_features(2), "neutral", 0.3)
    fast = fb.register_pending(_features(3), "neutral", 0.3)
    fb.record_label(keep, "angry", response_ms=1500)
    fb.record_label(unsure, "unsure", response_ms=1500)
    fb.record_label(fast, "sadness", response_ms=100)   # too fast to be real

    X, y, _ = fb.load_training_pairs()
    assert len(y) == 1 and y[0] == "angry"


def test_holdout_label_collected_but_excluded_from_training(store):
    """sarcasm has no class in the model yet — store it, don't train on it."""
    fid = fb.register_pending(_features(), "neutral", 0.3)
    fb.record_label(fid, "sarcasm", response_ms=1500)

    X, y, _ = fb.load_training_pairs()
    assert len(y) == 0, "holdout label must not reach training"

    X2, y2, _ = fb.load_training_pairs(include_holdout=True)
    assert len(y2) == 1 and y2[0] == "sarcasm"

    assert fb.stats()["holdout"]["sarcasm"] == 1


def test_latest_answer_wins(store):
    """A viewer correcting themselves should overwrite, not duplicate."""
    fid = fb.register_pending(_features(), "neutral", 0.3)
    fb.record_label(fid, "angry", response_ms=1500)
    fb.record_label(fid, "sadness", response_ms=1600)
    X, y, _ = fb.load_training_pairs()
    assert len(y) == 1 and y[0] == "sadness"


def test_stats_counts(store):
    a = fb.register_pending(_features(1), "neutral", 0.3)
    fb.register_pending(_features(2), "neutral", 0.3)  # never answered
    fb.record_label(a, "angry", response_ms=1500)

    s = fb.stats()
    assert s["pending"] == 2
    assert s["answered"] == 1
    assert s["usable_for_training"] == 1
    assert s["by_label"]["angry"] == 1


def test_prune_keeps_answered_and_drops_stale(store):
    answered = fb.register_pending(_features(1), "neutral", 0.3)
    fb.record_label(answered, "angry", response_ms=1500)
    stale = fb.register_pending(_features(2), "neutral", 0.3)

    # Backdate the unanswered row past the TTL.
    rows = [json.loads(l) for l in
            (store / "pending.jsonl").read_text().strip().split("\n")]
    for r in rows:
        if r["id"] == stale:
            r["created"] = "2020-01-01T00:00:00+00:00"
    (store / "pending.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )

    assert fb.prune() == 1
    remaining = {json.loads(l)["id"] for l in
                 (store / "pending.jsonl").read_text().strip().split("\n")}
    assert answered in remaining and stale not in remaining


def test_client_config_hides_internals(store):
    """Thresholds and retention settings must not leak to the browser."""
    c = fb.client_config()
    for leaked in ("trigger_below", "min_response_ms", "holdout_labels",
                   "max_pending", "pending_ttl_days"):
        assert leaked not in c
    assert c["display_seconds"] == 8
    assert len(c["options"]) == 2
