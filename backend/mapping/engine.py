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
from typing import Any, Dict

_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "mapping_config.json"
)


@lru_cache(maxsize=1)
def _config() -> Dict[str, Any]:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def map_emotion_to_visual(emotion: Dict[str, Any]) -> Dict[str, Any]:
    """Map an emotion dict {category, valence, arousal} → visual spec dict."""
    cfg = _config()
    category = emotion.get("category", "neutral")
    valence = float(emotion.get("valence", 0.0))
    arousal = float(emotion.get("arousal", 0.0))
    return {
        "shape": _shape(cfg, category),
        "color": _color(cfg, category, valence, arousal),
        "size": _size(cfg, arousal),
        "motion": _motion(cfg, category, valence, arousal),
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
        sat["base"] + abs(arousal) * sat["arousal_gain"], sat["min"], sat["max"]
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
        s["base"] + abs(arousal) * s["arousal_gain"], s["min"], s["max"]
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
