"""The per-video baseline hybrid rendering scores against.

The value of the baseline is that it removes recording level and speaker range
from the picture. These tests pin the two properties that make that true — it
must not include the segment being rendered, and it must refuse to exist while
it is too thin to mean anything.
"""

from __future__ import annotations

from backend.mapping.reference import ProsodyReference

SEG = {
    "f0_mean": 200.0,
    "intensity_mean": 60.0,
    "f0_range": 150.0,
    "speech_rate_approx": 40.0,
    "jitter_local": 0.02,      # not tracked — measured arousal ignores it
}


def test_no_baseline_until_enough_history():
    """One segment's median is itself; every deviation would be zero."""
    ref = ProsodyReference(min_segments=3)
    assert ref.snapshot() is None
    ref.update(SEG)
    assert ref.snapshot() is None
    ref.update(SEG)
    assert ref.snapshot() is None
    ref.update(SEG)
    assert ref.snapshot() is not None


def test_baseline_is_a_median_not_a_mean():
    """One shouted line must not drag the baseline with it."""
    ref = ProsodyReference(min_segments=1)
    for db in (58.0, 60.0, 62.0, 400.0):
        ref.update({**SEG, "intensity_mean": db})
    assert ref.snapshot()["intensity_mean"] == 61.0


def test_only_the_features_measured_arousal_reads_are_tracked():
    ref = ProsodyReference(min_segments=1)
    ref.update(SEG)
    assert set(ref.snapshot()) == {
        "f0_mean", "intensity_mean", "f0_range", "speech_rate_approx"
    }


def test_missing_feature_does_not_poison_the_baseline():
    """A segment PRAAT could not measure must not be read as a zero."""
    ref = ProsodyReference(min_segments=1)
    ref.update(SEG)
    ref.update({k: v for k, v in SEG.items() if k != "f0_mean"})
    assert ref.snapshot()["f0_mean"] == 200.0


def test_non_numeric_values_are_skipped():
    ref = ProsodyReference(min_segments=1)
    ref.update(SEG)
    ref.update({**SEG, "f0_mean": None, "intensity_mean": "loud"})
    snap = ref.snapshot()
    assert snap["f0_mean"] == 200.0
    assert snap["intensity_mean"] == 60.0


def test_counts_every_segment_even_unmeasurable_ones():
    """Silence still advances the video; it just contributes no numbers."""
    ref = ProsodyReference(min_segments=3)
    for _ in range(3):
        ref.update({})
    assert len(ref) == 3
    assert ref.snapshot() is None      # enough segments, no usable numbers
