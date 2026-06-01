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
) -> Dict[str, Any]:
    """Map an emotion vector (+ optional measured prosody) → visual spec dict.

    The base visual comes from the emotion vector {category, valence, arousal}
    (predicted by wav2vec2). When `prosody` (the interpretable PRAAT features)
    is supplied, prosody_modulation nudges motion/size from the MEASURED
    acoustics — so the explainable signal drives the output, not just the
    black-box embedding.
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
    if prosody:
        visual = _apply_prosody(cfg, visual, prosody)
    return visual


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
