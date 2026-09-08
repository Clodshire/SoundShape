"""Calibration scoring — the diagnosis and what it does to the weights.

The feature's whole claim is that a weak channel gets the RIGHT treatment: a
channel nobody can see should get wider, a channel people see but cannot read
should get quieter. Those are opposite actions, so getting the diagnosis
backwards would make the display worse while looking like it worked. These
tests pin the four cases down.
"""

from __future__ import annotations

import json

import pytest

from backend.pipeline import calibration


def scores(**channels):
    """Build a score dict: channel="<discrimination acc>,<semantic acc>"."""
    out = {}
    for name, pair in channels.items():
        d, s = pair
        out[name] = {
            "discrimination": {"n": 2, "accuracy": d},
            "semantic": {"n": 3, "accuracy": s},
        }
    return out


GOOD = (1.0, 1.0)


def test_all_channels_working_changes_nothing():
    w = calibration.derive_weights(
        scores(hue=GOOD, shape=GOOD, size=GOOD, motion=GOOD)
    )
    assert set(w.values()) == {1.0}


def test_invisible_channel_is_widened():
    """Meaning is there, the difference is not — widen the range."""
    w = calibration.derive_weights(
        scores(hue=GOOD, shape=GOOD, motion=GOOD, size=(0.0, 0.33))
    )
    assert w["size"] > 1.0
    assert w["motion"] == 1.0


def test_visible_but_meaningless_channel_is_quietened():
    """Saturating a colour that means nothing does not make it mean something."""
    w = calibration.derive_weights(
        scores(shape=GOOD, size=GOOD, motion=GOOD, hue=(1.0, 0.0))
    )
    assert w["saturation"] < 1.0


def test_the_two_failures_are_treated_oppositely():
    """The core claim — same channel, different reason, opposite fix."""
    invisible = calibration.derive_weights(
        scores(hue=GOOD, shape=GOOD, motion=GOOD, size=(0.0, 0.33))
    )
    meaningless = calibration.derive_weights(
        scores(hue=GOOD, shape=GOOD, motion=GOOD, size=(1.0, 0.0))
    )
    assert invisible["size"] > 1.0 > meaningless["size"]


def test_shape_has_no_knob_so_its_load_is_redistributed():
    """shape is categorical — it can only be compensated for, never tuned."""
    w = calibration.derive_weights(
        scores(hue=GOOD, size=GOOD, motion=GOOD, shape=(1.0, 0.0))
    )
    assert "shape" not in w
    assert all(w[g] > 1.0 for g in ("saturation", "size", "motion"))


def test_load_never_goes_to_a_channel_that_failed():
    """Piling work onto a broken channel would make the display worse."""
    w = calibration.derive_weights(
        scores(shape=(1.0, 0.0), hue=(1.0, 0.0), size=GOOD, motion=GOOD)
    )
    assert w["saturation"] < 1.0      # hue failed → quietened, not topped up
    assert w["size"] > 1.0            # working channels absorb shape's share


def test_weights_stay_inside_the_configured_range():
    """Never zero: redundant coding is the fallback when the strong channel fails."""
    cfg = calibration.load_config()["weights"]
    w = calibration.derive_weights(
        scores(hue=(1.0, 0.0), shape=(1.0, 0.0), size=(0.0, 0.0), motion=(0.0, 0.0))
    )
    assert all(cfg["min"] <= v <= cfg["max"] for v in w.values())


def test_untested_lightness_is_left_alone():
    """Valence cannot be judged by eye, so it is neither measured nor moved."""
    w = calibration.derive_weights(
        scores(hue=GOOD, size=GOOD, motion=GOOD, shape=(1.0, 0.0))
    )
    assert w["lightness"] == 1.0


def test_careless_answers_are_dropped_before_scoring():
    """Same rule the feedback loop uses — too fast was not a judgement."""
    fast = [
        {"kind": "semantic", "channel": "hue", "correct": True, "response_ms": 50}
        for _ in range(3)
    ]
    slow = [
        {"kind": "semantic", "channel": "hue", "correct": False, "response_ms": 3000}
        for _ in range(2)
    ]
    s = calibration.score_channels(fast + slow)
    assert s["hue"]["semantic"]["n"] == 2
    assert s["hue"]["semantic"]["accuracy"] == 0.0


def test_a_channel_with_no_trials_is_not_invented():
    s = calibration.score_channels(
        [{"kind": "semantic", "channel": "hue", "correct": True, "response_ms": 2000}]
    )
    assert "motion" not in s
    assert s["hue"]["discrimination"]["accuracy"] is None


def test_session_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(calibration, "STORE_DIR", tmp_path)
    monkeypatch.setattr(calibration, "SESSIONS", tmp_path / "sessions.jsonl")
    trials = [
        {"kind": "semantic", "channel": "hue", "correct": True,
         "expected": "joy", "answer": "joy", "response_ms": 1500},
        {"kind": "semantic", "channel": "shape", "correct": False,
         "expected": "fear", "answer": "anger", "response_ms": 1800},
    ]
    out = calibration.record_session(trials, mode="short", participant_group="test")
    assert out["id"].startswith("cal_")
    assert "weights" in out

    st = calibration.stats()
    assert st["participants"] == 1
    # A wrong answer records WHICH confusion, so a weak mapping rule is findable.
    assert st["confusions"]["fear"]["anger"] == 1


def test_stats_counts_which_channel_each_person_read_best():
    """The question that decides whether personalisation deserves to exist."""
    import types

    sessions = [
        {"scores": scores(hue=(1.0, 1.0), motion=(1.0, 0.33)), "trials": [],
         "crossover": []},
        {"scores": scores(hue=(1.0, 0.33), motion=(1.0, 1.0)), "trials": [],
         "crossover": []},
    ]
    original = calibration._iter_sessions
    calibration._iter_sessions = lambda: iter(sessions)
    try:
        st = calibration.stats()
    finally:
        calibration._iter_sessions = original
    assert st["best_channel_counts"] == {"hue": 1, "motion": 1}


def test_research_run_is_not_filed_twice(tmp_path, monkeypatch):
    """A full run scores mid-test, then files once at the end.

    The measurement block has to be scored before the crossover block can be
    built from its weights. If that intermediate scoring also wrote a row, every
    research participant would appear twice and their answers would be counted
    twice in the aggregate — quietly halving the apparent sample size error.
    """
    monkeypatch.setattr(calibration, "STORE_DIR", tmp_path)
    monkeypatch.setattr(calibration, "SESSIONS", tmp_path / "sessions.jsonl")
    trials = [
        {"kind": "semantic", "channel": "hue", "correct": True,
         "expected": "joy", "answer": "joy", "response_ms": 1500}
    ]

    mid = calibration.record_session(trials, mode="full", store=False)
    assert mid["id"] is None
    assert mid["weights"]              # still scores, just does not file
    assert calibration.stats()["participants"] == 0

    calibration.record_session(
        trials, mode="full",
        crossover=[{"condition": "default", "correct": True}],
        store=True,
    )
    assert calibration.stats()["participants"] == 1


def test_intensity_answers_stay_out_of_the_emotion_confusions(tmp_path, monkeypatch):
    """left/right is not an emotion confusion and would make the matrix useless."""
    monkeypatch.setattr(calibration, "STORE_DIR", tmp_path)
    monkeypatch.setattr(calibration, "SESSIONS", tmp_path / "sessions.jsonl")
    calibration.record_session(
        [
            {"kind": "semantic", "channel": "size", "correct": False,
             "expected": "left", "answer": "right", "response_ms": 1200},
            {"kind": "semantic", "channel": "hue", "correct": False,
             "expected": "fear", "answer": "sadness", "response_ms": 1400},
        ]
    )
    confusions = calibration.stats()["confusions"]
    assert "left" not in confusions
    assert confusions["fear"]["sadness"] == 1


def test_crossover_counts_both_conditions(tmp_path, monkeypatch):
    """The crossover tally is the whole test of whether personalisation works."""
    monkeypatch.setattr(calibration, "STORE_DIR", tmp_path)
    monkeypatch.setattr(calibration, "SESSIONS", tmp_path / "sessions.jsonl")
    calibration.record_session(
        [{"kind": "semantic", "channel": "hue", "correct": True,
          "expected": "joy", "answer": "joy", "response_ms": 1500}],
        mode="full",
        crossover=[
            {"condition": "default", "correct": False},
            {"condition": "personal", "correct": True},
            {"condition": "personal", "correct": True},
        ],
    )
    c = calibration.stats()["crossover"]
    assert c["default_n"] == 1 and c["default_correct"] == 0
    assert c["personal_n"] == 2 and c["personal_correct"] == 2
