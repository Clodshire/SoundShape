"""Speaker-turn detection — the decisions that keep a wrong dash off the screen.

The feature adds one mark to the caption, so the whole risk is concentrated in
when that mark appears. A dash that should not be there tells the viewer someone
else spoke — it invents information. A missing dash only withholds it, which is
the situation the product is already in. Every test here exists to pin down that
asymmetry.

The model itself is exercised only in the `slow` test; the rest run against
synthetic embeddings, so the suite stays fast.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend.pipeline import speaker


def vec(*values) -> np.ndarray:
    """A normalised embedding, for driving the tracker without the model."""
    v = np.array(values, dtype=np.float32)
    return v / np.linalg.norm(v)


A = vec(1, 0, 0)
A_NEAR = vec(0.97, 0.24, 0)      # same speaker, slightly different delivery
B = vec(0, 1, 0)                  # clearly someone else


class FakeTracker(speaker.TurnTracker):
    """TurnTracker with the encoder replaced by a queue of embeddings."""

    def __init__(self, embeddings, **kw):
        super().__init__(**kw)
        self._queue = list(embeddings)

    def update(self, samples=None, sample_rate=16_000, duration=3.0):
        nxt = self._queue.pop(0) if self._queue else None
        original = speaker.embed
        speaker.embed = lambda *a, **k: nxt
        try:
            return super().update(np.ones(16_000, dtype=np.float32),
                                  sample_rate, duration)
        finally:
            speaker.embed = original


def test_disabled_by_default():
    """Turn marks stay off until the experiment says they help."""
    assert speaker.is_enabled() is False


def test_a_broken_config_disables_rather_than_raises(monkeypatch, tmp_path):
    bad = tmp_path / "broken.json"
    bad.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(speaker, "CONFIG_PATH", bad)
    assert speaker.is_enabled() is False


def test_threshold_is_set_for_precision_not_peak_accuracy():
    """Measured on RAVDESS: accuracy peaks at 0.60, precision keeps rising.

    A wrong dash invents information; a missing one only withholds it. The
    shipped threshold must therefore sit above the accuracy peak.
    """
    assert speaker.load_config()["change_distance"] >= 0.65


def test_first_segment_is_never_a_turn():
    """A dash on line one would imply a speaker before it."""
    t = FakeTracker([A])
    assert t.update().changed is False


def test_same_speaker_is_not_marked():
    t = FakeTracker([A, A_NEAR])
    t.update()
    assert t.update().changed is False


def test_a_different_speaker_is_marked():
    t = FakeTracker([A, B])
    t.update()
    turn = t.update()
    assert turn.changed is True
    assert turn.distance > t.threshold


def test_returning_to_the_first_speaker_is_also_a_turn():
    """A→B→A is two changes; the dash means 'different from the line before'."""
    t = FakeTracker([A, B, A])
    t.update()
    assert t.update().changed is True
    assert t.update().changed is True


def test_a_too_short_segment_gets_no_decision():
    t = FakeTracker([A, B])
    t.update()
    turn = t.update(duration=0.4)
    assert turn.changed is False
    assert "short" in turn.reason


def test_a_too_short_segment_does_not_become_the_reference():
    """Otherwise one unreliable embedding poisons every later comparison.

    A, then a short B that is skipped, then A again — the last line is the same
    speaker as the last thing we could actually measure, so no dash.
    """
    t = FakeTracker([A, B, A_NEAR])
    t.update()
    t.update(duration=0.4)          # skipped, must not be stored
    assert t.update().changed is False


def test_an_unusable_segment_does_not_become_the_reference():
    """Silence or a failed embedding must not shift the comparison either."""
    t = FakeTracker([A, None, A_NEAR])
    t.update()
    assert t.update().changed is False
    assert t.update().changed is False


def test_embedding_returns_none_for_silence():
    assert speaker.embed(np.zeros(16_000, dtype=np.float32), 16_000) is None


def test_embedding_returns_none_for_empty_input():
    assert speaker.embed(np.zeros(0, dtype=np.float32), 16_000) is None


def test_distance_is_zero_for_identical_and_one_for_orthogonal():
    assert speaker.distance(A, A) == pytest.approx(0.0, abs=1e-6)
    assert speaker.distance(A, B) == pytest.approx(1.0, abs=1e-6)


@pytest.mark.slow
def test_real_model_separates_two_actors():
    """Runs ECAPA. Two clips from one actor must sit closer than two actors."""
    import glob

    import soundfile as sf

    files = sorted(glob.glob(str(REPO_CLIPS)))
    if len(files) < 3:
        pytest.skip("RAVDESS clips not present")
    by_actor = {}
    for f in files:
        actor = f.split("/")[-1].split("-")[6].split(".")[0]
        by_actor.setdefault(actor, []).append(f)
    actors = [a for a, fs in by_actor.items() if len(fs) >= 2][:2]
    if len(actors) < 2:
        pytest.skip("need two actors")

    def emb(path):
        x, sr = sf.read(path, dtype="float32", always_2d=False)
        return speaker.embed(x, sr)

    a1, a2 = emb(by_actor[actors[0]][0]), emb(by_actor[actors[0]][1])
    b1 = emb(by_actor[actors[1]][0])
    assert speaker.distance(a1, a2) < speaker.distance(a1, b1)


REPO_CLIPS = speaker.REPO / "data" / "datasets" / "RAVDESS" / "Actor_*" / "*.wav"
