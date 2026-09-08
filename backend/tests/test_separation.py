"""Source separation — the gate, the skip decision, and the failure paths.

The model itself is not exercised here: loading HDemucs costs several seconds
and separating costs several more, which does not belong in a suite that runs
on every change. What IS pinned down is everything around it — that the feature
stays off until switched on, that speech-only material is recognised and
skipped, and that nothing about this can take the pipeline down with it.

The one test that does run the real model is marked `slow` and skipped by
default; run it with `-m slow` after touching the separation maths.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from backend.pipeline import separation


@pytest.fixture
def enabled(monkeypatch, tmp_path):
    """Point the module at a temporary config it is allowed to switch on."""
    cfg = json.loads(separation.CONFIG_PATH.read_text(encoding="utf-8"))
    cfg["enabled"] = True
    path = tmp_path / "separation_config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(separation, "CONFIG_PATH", path)
    return cfg


def test_enabled_by_default():
    """On since the RAVDESS comparison — see separation_config._enabled_doc.

    Pinned rather than assumed: this decides whether every video pays for
    separation, so flipping it should take a deliberate edit here.
    """
    assert separation.is_enabled() is True


def test_threshold_skips_the_conditions_where_it_did_not_help():
    """The threshold is the whole reason turning this on is affordable.

    Music-energy ratios measured on one speech clip, against the accuracy the
    same conditions produced on RAVDESS:

        0.024  speech alone                     —
        0.281  music 10 dB under dialogue       +2.3%p,  p=0.27    not significant
        0.472  music 5 dB under dialogue        +5.6%p,  p=0.009   significant
        0.697  music level with dialogue       +10.6%p,  p<0.001   significant

    So the threshold must sit above 0.281 and no higher than 0.472: any lower
    and the feature spends minutes per video buying nothing, any higher and it
    skips a case where separation was shown to help.
    """
    threshold = separation.load_config()["music_energy_ratio_min"]
    assert 0.281 < threshold <= 0.472


def test_separate_file_returns_none_while_disabled(tmp_path, monkeypatch):
    """The gate is checked before any file is touched."""
    import json as _json

    cfg = _json.loads(separation.CONFIG_PATH.read_text(encoding="utf-8"))
    cfg["enabled"] = False
    off = tmp_path / "off.json"
    off.write_text(_json.dumps(cfg), encoding="utf-8")
    monkeypatch.setattr(separation, "CONFIG_PATH", off)
    assert separation.separate_file(tmp_path / "does-not-exist.wav") is None


def test_a_broken_config_disables_rather_than_raises(monkeypatch, tmp_path):
    """A bad config must degrade to 'off', never take analysis down."""
    bad = tmp_path / "broken.json"
    bad.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(separation, "CONFIG_PATH", bad)
    assert separation.is_enabled() is False


def test_unreadable_file_returns_none_not_an_exception(enabled, tmp_path):
    """A corrupt upload must not become a 500."""
    junk = tmp_path / "not-audio.wav"
    junk.write_bytes(b"this is not a wav file")
    assert separation.separate_file(junk) is None


def test_music_energy_ratio_is_measured_against_the_mixture():
    """Against the vocals instead, a silent passage would read as all music."""
    rng = np.random.default_rng(0)
    mixture = rng.normal(size=44100).astype(np.float32)
    assert separation.music_energy_ratio(mixture, mixture) == pytest.approx(1.0)
    assert separation.music_energy_ratio(np.zeros(44100), mixture) == 0.0


def test_music_energy_ratio_survives_digital_silence():
    """Dividing by a silent mixture must not produce inf or NaN."""
    assert separation.music_energy_ratio(np.zeros(100), np.zeros(100)) == 0.0


def test_separate_array_rejects_the_wrong_sample_rate():
    """16 kHz mono has already thrown away what the model needs."""
    with pytest.raises(ValueError, match="44100"):
        separation.separate_array(np.zeros((2, 1000), dtype=np.float32), 16_000)


def test_result_reports_duration_from_the_vocals_track():
    r = separation.SeparationResult(
        vocals=np.zeros(44_100, dtype=np.float32),
        music=np.zeros(0, dtype=np.float32),
        sample_rate=44_100,
        music_present=False,
        music_energy_ratio=0.0,
        skipped=True,
    )
    assert r.duration == pytest.approx(1.0)


def test_over_length_input_is_refused(enabled, monkeypatch, tmp_path):
    """A three-hour upload must not quietly occupy the machine."""
    import soundfile as sf

    cfg = json.loads(separation.CONFIG_PATH.read_text(encoding="utf-8"))
    cfg["max_seconds"] = 0.5
    separation.CONFIG_PATH.write_text(json.dumps(cfg), encoding="utf-8")

    path = tmp_path / "long.wav"
    sf.write(path, np.zeros((44_100, 2), dtype=np.float32), 44_100)
    assert separation.separate_file(path) is None


@pytest.mark.slow
def test_speech_only_audio_is_detected_and_skipped(enabled, tmp_path):
    """The saving that makes this affordable: most clips have no score.

    Runs the real model. On an M3 this takes a few seconds.
    """
    import soundfile as sf

    from backend.pipeline.audio_io import extract_for_separation

    src = separation.REPO / "data" / "samples" / "long3.wav"
    if not src.exists():
        pytest.skip("sample audio not present")
    wav = extract_for_separation(src, out_dir=tmp_path)

    result = separation.separate_file(wav.path)
    assert result is not None
    assert result.skipped is True
    assert result.music_present is False
    # Skipping hands back the mixture, so downstream still has audio to read.
    assert len(result.vocals) > 0
