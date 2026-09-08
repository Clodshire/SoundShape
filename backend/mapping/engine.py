"""Cross-modal mapping engine — emotion → visual spec, driven by config.

The mapping rules are NOT hardcoded here. They live in the language-agnostic
spec at config/mapping_config.json (the single source of truth shared with
the frontend renderer). This module just interprets that spec.

Every rule in the config carries a "citation" field pointing to the research
that grounds it; the human-readable rationale lives in docs/mapping_rationale.md.

Output matches the frontend's VisualSpec type (frontend/src/types/emotion.ts):

    {
      "shape":  str,
      "color":  {"h": float, "s": float, "l": float},
      "size":   float,                       # 0..1
      "motion": {"type": str, "amplitude": float, "speed": float}
    }
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "mapping_config.json"
)


@lru_cache(maxsize=1)
def _config() -> Dict[str, Any]:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _arousal01(arousal: float) -> float:
    """Map signed arousal [-1, +1] → [0, 1] monotonically.

    Calm (negative arousal) → near 0; excited (positive) → near 1. This is
    the fix for the old |arousal| formulation, which incorrectly made very
    calm states render as large/saturated as very excited ones.
    """
    return (arousal + 1.0) / 2.0


def map_emotion_to_visual(
    emotion: Dict[str, Any],
    prosody: Optional[Dict[str, Any]] = None,
    reference: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None,
    weights: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """Map an emotion vector (+ optional measured prosody) → visual spec dict.

    Two rendering modes, selected by `mode` or by rendering.mode in the config:

    full_ai
        The historical behaviour. Every channel is derived from the emotion
        vector {category, valence, arousal}; prosody_modulation then nudges
        size and motion using the measured PRAAT features.

    hybrid
        Size, saturation and motion are re-sourced from the measurement itself
        rather than from the classifier's arousal estimate. Shape, hue and
        lightness stay with the classifier, because category and valence are
        the parts that genuinely require inference. Requires `prosody`; without
        it there is nothing to measure and full_ai is used instead.

    `reference` is an optional per-video baseline of the same prosody features
    (typically a running median). When present, measured arousal is computed as
    a deviation from it — necessary because PRAAT intensity is relative to the
    recording level, not to the voice. See measured_arousal._relative_doc.

    `weights` are per-viewer channel gains from the calibration test
    (backend/pipeline/calibration.py). They stretch or compress a channel's
    range around its neutral midpoint; they never change which emotion maps to
    which hue or shape, so two viewers always see the same colour for the same
    emotion, just at different strengths.
    """
    cfg = _config()
    category = emotion.get("category", "neutral")
    valence = float(emotion.get("valence", 0.0))
    arousal = float(emotion.get("arousal", 0.0))
    visual = {
        "shape": _shape(cfg, category),
        "color": _color(cfg, category, valence, arousal),
        "size": _size(cfg, arousal),
        "motion": _motion(cfg, category, valence, arousal),
    }
    if mode is None:
        mode = cfg.get("rendering", {}).get("mode", "full_ai")
    hybrid = mode == "hybrid" and bool(prosody)

    if hybrid:
        visual = _apply_hybrid(cfg, visual, prosody or {}, reference)
    elif prosody:
        visual = _apply_prosody(cfg, visual, prosody)

    conf = emotion.get("category_confidence", emotion.get("confidence"))
    if conf is not None:
        visual = _apply_confidence(cfg, visual, float(conf), hybrid=hybrid)
    if weights:
        visual = _apply_weights(cfg, visual, weights)
    return visual


def _apply_confidence(
    cfg: dict, visual: Dict[str, Any], confidence: float, hybrid: bool = False
) -> Dict[str, Any]:
    """Mute/shrink/calm the visual when the classifier is unsure.

    In hybrid mode this does NOTHING, and that is deliberate. Size and motion
    are measurements there, so dimming them would misreport the voice; and
    saturation already means measured arousal, so dimming THAT made a calm
    voice and an unsure classifier look identical to a viewer. Hybrid instead
    expresses doubt as reduced opacity, applied by the renderer, which leaves
    every measured channel telling the truth.
    """
    cc = cfg.get("confidence")
    if not cc or not cc.get("enabled", False):
        return visual
    f = _clamp(
        (confidence - cc["conf_min"]) / (cc["conf_max"] - cc["conf_min"]),
        cc["floor"],
        1.0,
    )
    if hybrid:
        return visual
    color = dict(visual["color"])
    color["s"] = color["s"] * f
    size_min = cfg["size"]["min"]
    size = size_min + (visual["size"] - size_min) * f
    motion = dict(visual["motion"])
    motion["amplitude"] = motion["amplitude"] * f
    return {
        "shape": visual["shape"],
        "color": color,
        "size": size,
        "motion": motion,
    }


def _norm(x: float, lo: float, hi: float) -> float:
    if hi <= lo:
        return 0.0
    return _clamp((x - lo) / (hi - lo), 0.0, 1.0)


def _apply_prosody(
    cfg: dict, visual: Dict[str, Any], prosody: Dict[str, Any]
) -> Dict[str, Any]:
    """Modulate the base visual using measured PRAAT prosody features."""
    pm = cfg.get("prosody_modulation")
    if not pm or not pm.get("enabled", False):
        return visual

    motion = dict(visual["motion"])

    # Instability: jitter + shimmer → motion amplitude + a little speed.
    inst = pm["instability"]
    jit = _norm(
        float(prosody.get("jitter_local", 0.0)),
        inst["jitter_min"],
        inst["jitter_max"],
    )
    shi = _norm(
        float(prosody.get("shimmer_local", 0.0)),
        inst["shimmer_min"],
        inst["shimmer_max"],
    )
    instability = (jit + shi) / 2.0
    motion["amplitude"] = _clamp(
        motion["amplitude"] * (1.0 + instability * inst["amplitude_gain"]),
        0.0,
        1.0,
    )
    motion["speed"] = _clamp(
        motion["speed"] * (1.0 + instability * inst["speed_gain"]), 0.0, 1.5
    )

    # Speech rate → motion speed.
    sr = pm["speech_rate"]
    rate = _norm(
        float(prosody.get("speech_rate_approx", 0.0)),
        sr["rate_min"],
        sr["rate_max"],
    )
    motion["speed"] = _clamp(
        motion["speed"] * (1.0 + rate * sr["speed_gain"]), 0.0, 1.5
    )

    # Intensity (loudness) → size / brightness.
    inten_cfg = pm["intensity"]
    inten = _norm(
        float(prosody.get("intensity_mean", 0.0)),
        inten_cfg["db_min"],
        inten_cfg["db_max"],
    )
    size = _clamp(visual["size"] + inten * inten_cfg["size_gain"], 0.0, 1.0)

    return {
        "shape": visual["shape"],
        "color": visual["color"],
        "size": size,
        "motion": motion,
    }


def _measured_arousal(
    cfg: dict,
    prosody: Dict[str, Any],
    reference: Optional[Dict[str, Any]] = None,
) -> float:
    """Arousal read off the acoustics, in [0, 1]. No classifier involved.

    A weighted blend of the components listed in config.measured_arousal. With
    a `reference` each component is scored as a deviation from that baseline
    (rel_span sets the full-scale deviation); without one it is scored against
    the absolute range. The relative form is preferred because PRAAT intensity
    depends on the recording level — see measured_arousal._relative_doc.
    """
    ma = cfg.get("measured_arousal")
    if not ma:
        return 0.0
    total = 0.0
    weight = 0.0
    for comp in ma["components"]:
        key = comp["key"]
        if key not in prosody:
            continue
        value = float(prosody[key])
        if reference and key in reference:
            span = float(comp["rel_span"])
            score = _norm(value - float(reference[key]), -span, span)
        else:
            score = _norm(value, float(comp["abs_min"]), float(comp["abs_max"]))
        total += score * float(comp["weight"])
        weight += float(comp["weight"])
    # Renormalise so a missing feature reweights the rest instead of dragging
    # the result toward zero.
    return total / weight if weight else 0.0


def _instability(cfg: dict, prosody: Dict[str, Any]) -> float:
    """Vocal instability (jitter + shimmer) in [0, 1].

    Deliberately kept out of measured arousal: on RAVDESS these two score .46
    AUC against the normal/strong intensity label, i.e. they carry no arousal
    signal. What they do carry is tremor, which is what motion amplitude shows.
    """
    inst = cfg["prosody_modulation"]["instability"]
    jit = _norm(
        float(prosody.get("jitter_local", 0.0)),
        inst["jitter_min"],
        inst["jitter_max"],
    )
    shi = _norm(
        float(prosody.get("shimmer_local", 0.0)),
        inst["shimmer_min"],
        inst["shimmer_max"],
    )
    return (jit + shi) / 2.0


def _apply_hybrid(
    cfg: dict,
    visual: Dict[str, Any],
    prosody: Dict[str, Any],
    reference: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Re-source size, saturation and motion from the measurement itself.

    Shape, hue and lightness are left exactly as the classifier set them, and
    motion.type stays too — it is a categorical choice like shape. Everything
    this function writes is a function of the acoustics alone, so those channels
    stay truthful even when the emotion label is wrong.
    """
    hb = cfg.get("hybrid")
    if not hb:
        return visual

    arousal_m = _measured_arousal(cfg, prosody, reference)

    sz = hb["size"]
    size = _clamp(sz["base"] + arousal_m * sz["gain"], sz["min"], sz["max"])

    color = dict(visual["color"])
    # A neutral reading is rendered as grey (hue 0, saturation 0). Saturating it
    # from measured arousal would paint it red, so neutral is left alone.
    if color.get("s", 0.0) > 0.0:
        sat = hb["saturation"]
        color["s"] = _clamp(
            sat["base"] + arousal_m * sat["gain"], sat["min"], sat["max"]
        )

    motion = dict(visual["motion"])
    amp = hb["motion"]["amplitude"]
    motion["amplitude"] = _clamp(
        amp["base"] + _instability(cfg, prosody) * amp["gain"],
        amp["min"],
        amp["max"],
    )
    spd = hb["motion"]["speed"]
    rate = cfg["prosody_modulation"]["speech_rate"]
    motion["speed"] = _clamp(
        spd["base"]
        + _norm(
            float(prosody.get("speech_rate_approx", 0.0)),
            rate["rate_min"],
            rate["rate_max"],
        )
        * spd["gain"],
        spd["min"],
        spd["max"],
    )

    return {
        "shape": visual["shape"],
        "color": color,
        "size": size,
        "motion": motion,
    }

def _stretch(value: float, mid: float, gain: float, lo: float, hi: float) -> float:
    """Move `value` away from (gain > 1) or toward (gain < 1) a midpoint.

    Scaling the DISTANCE from a midpoint rather than the value itself is what
    makes a gain mean "how far apart do these channels' levels sit", which is
    the thing calibration measures. Multiplying the value directly would just
    make everything brighter or bigger, changing the average instead of the
    contrast, and a viewer who cannot tell two levels apart would still not be
    able to tell them apart.
    """
    return _clamp(mid + (value - mid) * gain, lo, hi)


def _apply_weights(
    cfg: dict, visual: Dict[str, Any], weights: Dict[str, float]
) -> Dict[str, Any]:
    """Per-viewer channel gains from calibration.

    Only channels with a RANGE can be weighted. Hue and shape are categorical —
    a shape a viewer cannot read cannot be made readable by turning a knob, so
    calibration compensates by widening the others instead (see
    calibration.derive_weights). Nothing here changes which emotion maps to
    which hue or shape.
    """
    color = dict(visual["color"])
    motion = dict(visual["motion"])
    size = visual["size"]

    sat_w = float(weights.get("saturation", 1.0))
    if sat_w != 1.0 and color.get("s", 0.0) > 0.0:
        sc = cfg["color"]["saturation"]
        mid = (sc["min"] + sc["max"]) / 2.0
        color["s"] = _stretch(color["s"], mid, sat_w, sc["min"], sc["max"])

    light_w = float(weights.get("lightness", 1.0))
    if light_w != 1.0:
        lc = cfg["color"]["lightness"]
        color["l"] = _stretch(
            color["l"], lc["base"], light_w, lc["min"], lc["max"]
        )

    size_w = float(weights.get("size", 1.0))
    if size_w != 1.0:
        sz = cfg["size"]
        mid = (sz["min"] + sz["max"]) / 2.0
        size = _stretch(size, mid, size_w, sz["min"], sz["max"])

    motion_w = float(weights.get("motion", 1.0))
    if motion_w != 1.0:
        # Motion has a natural floor at rest, so it is scaled from zero rather
        # than from a midpoint — "more movement" is the whole scale.
        motion["amplitude"] = _clamp(motion["amplitude"] * motion_w, 0.0, 1.0)
        motion["speed"] = _clamp(motion["speed"] * motion_w, 0.0, 1.5)

    return {
        "shape": visual["shape"],
        "color": color,
        "size": size,
        "motion": motion,
    }

def _shape(cfg: dict, category: str) -> str:
    return cfg["shape"]["by_category"].get(category, cfg["shape"]["default"])


def _color(cfg: dict, category: str, valence: float, arousal: float) -> dict:
    c = cfg["color"]
    if category == "neutral":
        return dict(c["neutral"])
    hue = c["hue_by_category"].get(category, 0)
    sat = c["saturation"]
    s = _clamp(
        sat["base"] + _arousal01(arousal) * sat["arousal_gain"],
        sat["min"],
        sat["max"],
    )
    lt = c["lightness"]
    light = _clamp(
        lt["base"] + valence * lt["valence_gain"] + arousal * lt["arousal_gain"],
        lt["min"],
        lt["max"],
    )
    return {"h": hue, "s": s, "l": light}


def _size(cfg: dict, arousal: float) -> float:
    s = cfg["size"]
    return _clamp(
        s["base"] + _arousal01(arousal) * s["arousal_gain"], s["min"], s["max"]
    )


def _matches(when: dict, category: str, valence: float, arousal: float) -> bool:
    if "category" in when and when["category"] != category:
        return False
    if "arousal_gt" in when and not (arousal > when["arousal_gt"]):
        return False
    if "arousal_lt" in when and not (arousal < when["arousal_lt"]):
        return False
    if "valence_gt" in when and not (valence > when["valence_gt"]):
        return False
    if "valence_lt" in when and not (valence < when["valence_lt"]):
        return False
    return True


def _motion(cfg: dict, category: str, valence: float, arousal: float) -> dict:
    for rule in cfg["motion"]["rules"]:
        if _matches(rule["when"], category, valence, arousal):
            return dict(rule["motion"])
    return dict(cfg["motion"]["default"])


if __name__ == "__main__":
    import sys
    from pprint import pprint

    # Demo: map a few representative emotions.
    samples = [
        {"category": "anger", "valence": -0.7, "arousal": 0.85},
        {"category": "sadness", "valence": -0.55, "arousal": -0.35},
        {"category": "joy", "valence": 0.7, "arousal": 0.6},
        {"category": "neutral", "valence": 0.0, "arousal": 0.0},
    ]
    if len(sys.argv) > 1:
        import json as _json

        samples = [_json.loads(sys.argv[1])]
    for s in samples:
        print(f"\n{s}")
        pprint(map_emotion_to_visual(s))
