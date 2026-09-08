"""Hybrid rendering: measured channels must not inherit classifier error.

The point of hybrid mode is a guarantee, not a tuning tweak — size, saturation
and motion are functions of the acoustics alone. These tests pin that guarantee
down, and pin down that turning the mode off changes nothing.
"""

from __future__ import annotations

import pytest

from backend.mapping.engine import map_emotion_to_visual

LOUD = {
    "f0_mean": 300.0,
    "intensity_mean": 70.0,
    "f0_range": 300.0,
    "speech_rate_approx": 70.0,
    "jitter_local": 0.03,
    "shimmer_local": 0.13,
}
QUIET = {
    "f0_mean": 110.0,
    "intensity_mean": 20.0,
    "f0_range": 70.0,
    "speech_rate_approx": 28.0,
    "jitter_local": 0.006,
    "shimmer_local": 0.04,
}


def measured(visual):
    """The channels hybrid mode promises are free of classification error."""
    return (
        visual["size"],
        visual["color"]["s"],
        visual["motion"]["amplitude"],
        visual["motion"]["speed"],
    )


def test_default_mode_is_hybrid():
    """Shipping default, set by the RAVDESS comparison — see rendering._default_doc.

    Pinned rather than assumed: flipping the default changes what every viewer
    sees, so it should take a deliberate edit here, not a stray config change.
    """
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    assert map_emotion_to_visual(e, LOUD) == map_emotion_to_visual(
        e, LOUD, mode="hybrid"
    )


def test_full_ai_is_still_reachable():
    """The comparison only stays honest while both modes still run."""
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    assert map_emotion_to_visual(e, LOUD, mode="full_ai") != map_emotion_to_visual(
        e, LOUD, mode="hybrid"
    )


@pytest.mark.parametrize("prosody", [LOUD, QUIET])
def test_measured_channels_ignore_the_predicted_category(prosody):
    base = None
    for category in ["anger", "joy", "sadness", "fear", "sarcasm"]:
        v = map_emotion_to_visual(
            {"category": category, "valence": -0.7, "arousal": 0.85},
            prosody,
            mode="hybrid",
        )
        if base is None:
            base = measured(v)
        else:
            assert measured(v) == base


def test_measured_channels_ignore_predicted_valence_and_arousal():
    """A wrong V/A estimate must not move a measured channel."""
    a = map_emotion_to_visual(
        {"category": "anger", "valence": -1.0, "arousal": -1.0}, LOUD, mode="hybrid"
    )
    b = map_emotion_to_visual(
        {"category": "anger", "valence": 1.0, "arousal": 1.0}, LOUD, mode="hybrid"
    )
    assert measured(a) == measured(b)


def test_full_ai_does_depend_on_predicted_arousal():
    """Guards the test above from passing for the wrong reason."""
    a = map_emotion_to_visual(
        {"category": "anger", "valence": -1.0, "arousal": -1.0}, LOUD, mode="full_ai"
    )
    b = map_emotion_to_visual(
        {"category": "anger", "valence": -1.0, "arousal": 1.0}, LOUD, mode="full_ai"
    )
    assert measured(a) != measured(b)


def test_louder_higher_voice_renders_larger():
    quiet = map_emotion_to_visual({"category": "joy"}, QUIET, mode="hybrid")
    loud = map_emotion_to_visual({"category": "joy"}, LOUD, mode="hybrid")
    assert loud["size"] > quiet["size"]
    assert loud["color"]["s"] > quiet["color"]["s"]


def test_low_confidence_changes_nothing_in_the_mapping_under_hybrid():
    """Doubt is shown as opacity by the renderer, not by touching a channel here.

    Every channel hybrid produces is either a measurement (size, saturation,
    motion) or the classifier's own label (shape, hue, lightness). Dimming a
    measurement would misreport the voice; dimming saturation specifically made
    a calm voice and an unsure classifier look identical, since saturation IS
    measured arousal in this mode.
    """
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    sure = map_emotion_to_visual({**e, "category_confidence": 0.95}, LOUD, mode="hybrid")
    unsure = map_emotion_to_visual({**e, "category_confidence": 0.2}, LOUD, mode="hybrid")
    assert unsure == sure


def test_low_confidence_in_full_ai_still_shrinks():
    """The original behaviour must survive in full_ai.

    Mode is passed explicitly: this asserts about full_ai specifically, so it
    must not silently start testing whatever the shipped default happens to be.
    """
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    sure = map_emotion_to_visual(
        {**e, "category_confidence": 0.95}, LOUD, mode="full_ai"
    )
    unsure = map_emotion_to_visual(
        {**e, "category_confidence": 0.2}, LOUD, mode="full_ai"
    )
    assert unsure["size"] < sure["size"]


def test_hybrid_without_prosody_falls_back():
    """Nothing to measure → do not silently render from an empty measurement."""
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    assert map_emotion_to_visual(e, None, mode="hybrid") == map_emotion_to_visual(
        e, None, mode="full_ai"
    )


def test_neutral_stays_grey():
    """Neutral is hue 0; saturating it from arousal would paint it red."""
    v = map_emotion_to_visual({"category": "neutral"}, LOUD, mode="hybrid")
    assert v["color"]["s"] == 0


def test_missing_feature_reweights_instead_of_dragging_to_zero():
    """A dropped feature must not be read as 'that feature was zero'."""
    full = map_emotion_to_visual({"category": "joy"}, LOUD, mode="hybrid")
    without_f0 = {k: v for k, v in LOUD.items() if k != "f0_mean"}
    partial = map_emotion_to_visual({"category": "joy"}, without_f0, mode="hybrid")
    assert partial["size"] == pytest.approx(full["size"], abs=0.15)


def test_reference_makes_arousal_relative_to_the_recording():
    """Same voice, same delivery, only the recording gain differs.

    Absolute dB moves the glyph; scored against the video's own baseline it
    should not. This is the per-actor 14.3 dB gain spread we measured on
    RAVDESS, which is larger than the normal-vs-strong difference itself.
    """
    hot = {**LOUD, "intensity_mean": LOUD["intensity_mean"] + 12.0}
    absolute_quiet = map_emotion_to_visual({"category": "joy"}, LOUD, mode="hybrid")
    absolute_hot = map_emotion_to_visual({"category": "joy"}, hot, mode="hybrid")
    assert absolute_hot["size"] != absolute_quiet["size"]

    rel_quiet = map_emotion_to_visual(
        {"category": "joy"}, LOUD, reference=LOUD, mode="hybrid"
    )
    rel_hot = map_emotion_to_visual(
        {"category": "joy"}, hot, reference=hot, mode="hybrid"
    )
    assert rel_hot["size"] == pytest.approx(rel_quiet["size"])


# ── calibration weights ──────────────────────────────────────────────
#
# Weights change how far apart a channel's levels sit for one viewer. What they
# must never do is change what an emotion looks like — two viewers have to see
# the same colour and the same shape for the same emotion, or they are not
# looking at the same language.

BOOST = {"saturation": 1.4, "lightness": 1.4, "size": 1.4, "motion": 1.4}
CUT = {"saturation": 0.6, "lightness": 0.6, "size": 0.6, "motion": 0.6}


def test_weights_never_change_identity():
    e = {"category": "anger", "valence": -0.7, "arousal": 0.85}
    plain = map_emotion_to_visual(e, LOUD)
    for w in (BOOST, CUT):
        v = map_emotion_to_visual(e, LOUD, weights=w)
        assert v["shape"] == plain["shape"]
        assert v["color"]["h"] == plain["color"]["h"]
        assert v["motion"]["type"] == plain["motion"]["type"]


def test_neutral_weights_are_a_no_op():
    e = {"category": "joy", "valence": 0.6, "arousal": 0.4}
    neutral = {"saturation": 1.0, "lightness": 1.0, "size": 1.0, "motion": 1.0}
    assert map_emotion_to_visual(e, LOUD, weights=neutral) == map_emotion_to_visual(
        e, LOUD
    )


def test_no_weights_is_identical_to_neutral_weights():
    """Calibration must be opt-in — an uncalibrated viewer sees the default."""
    e = {"category": "sadness", "valence": -0.5, "arousal": -0.3}
    assert map_emotion_to_visual(e, QUIET, weights=None) == map_emotion_to_visual(
        e, QUIET
    )


def test_boosting_a_channel_widens_the_gap_between_levels():
    """The point of a gain: the same two emotions become easier to tell apart."""
    calm = {"category": "joy", "valence": 0.6, "arousal": -0.5}
    excited = {"category": "joy", "valence": 0.6, "arousal": 0.9}
    plain_gap = abs(
        map_emotion_to_visual(excited, LOUD)["size"]
        - map_emotion_to_visual(calm, QUIET)["size"]
    )
    boosted_gap = abs(
        map_emotion_to_visual(excited, LOUD, weights=BOOST)["size"]
        - map_emotion_to_visual(calm, QUIET, weights=BOOST)["size"]
    )
    assert boosted_gap > plain_gap


def test_cutting_a_channel_narrows_the_gap():
    calm = {"category": "joy", "valence": 0.6, "arousal": -0.5}
    excited = {"category": "joy", "valence": 0.6, "arousal": 0.9}
    plain_gap = abs(
        map_emotion_to_visual(excited, LOUD)["size"]
        - map_emotion_to_visual(calm, QUIET)["size"]
    )
    cut_gap = abs(
        map_emotion_to_visual(excited, LOUD, weights=CUT)["size"]
        - map_emotion_to_visual(calm, QUIET, weights=CUT)["size"]
    )
    assert cut_gap < plain_gap


def test_weights_stay_inside_the_configured_channel_limits():
    """A large gain must clamp, not produce an unrenderable value."""
    e = {"category": "anger", "valence": -0.9, "arousal": 1.0}
    v = map_emotion_to_visual(
        e, LOUD, weights={"saturation": 9, "lightness": 9, "size": 9, "motion": 9}
    )
    from backend.mapping.engine import _config

    cfg = _config()
    assert cfg["size"]["min"] <= v["size"] <= cfg["size"]["max"]
    assert cfg["color"]["saturation"]["min"] <= v["color"]["s"] <= cfg["color"]["saturation"]["max"]
    assert cfg["color"]["lightness"]["min"] <= v["color"]["l"] <= cfg["color"]["lightness"]["max"]
    assert 0.0 <= v["motion"]["amplitude"] <= 1.0


def test_neutral_stays_grey_under_any_weight():
    """Grey means 'no reading'; a saturation gain must not paint it."""
    v = map_emotion_to_visual({"category": "neutral"}, LOUD, weights=BOOST)
    assert v["color"]["s"] == 0
