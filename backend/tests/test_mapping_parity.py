"""Cross-language parity: the Python and TypeScript mappings must agree exactly.

The mapping rules live in one config that both implementations read, and
`sync_mapping_config.py` guarantees the two copies of that FILE are identical.
But an identical config does not by itself guarantee identical OUTPUT — the two
implementations could still diverge (a clamp applied in one and not the other,
a different rounding, a rule read in a different order).

This test closes that hole: it runs the same cases through both engines and
compares the rendered visual spec byte for byte. If someone edits one
implementation without the other, this fails.

Skipped automatically when the frontend toolchain isn't installed, so the
suite still runs in a backend-only environment.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from backend.mapping.engine import map_emotion_to_visual

REPO = Path(__file__).resolve().parent.parent.parent
FRONTEND = REPO / "frontend"
# The probe lives inside frontend/ so tsx resolves the `@/*` path alias from
# that project's tsconfig; it is therefore run with cwd=frontend.
PROBE = FRONTEND / "scripts" / "mapping_probe.ts"
TSX = FRONTEND / "node_modules" / ".bin" / "tsx"

# Spread across categories, both valence/arousal signs, confidence gating, and
# prosody modulation on/off — the branches most likely to drift.
CASES = [
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8}},
    {"emotion": {"category": "sadness", "valence": -0.5, "arousal": -0.4}},
    {"emotion": {"category": "joy", "valence": 0.7, "arousal": 0.5}},
    {"emotion": {"category": "fear", "valence": -0.5, "arousal": 0.6}},
    {"emotion": {"category": "surprise", "valence": 0.1, "arousal": 0.7}},
    {"emotion": {"category": "neutral", "valence": 0.0, "arousal": 0.0}},
    {"emotion": {"category": "sarcasm", "valence": -0.35, "arousal": 0.15}},
    {"emotion": {"category": "sincerity", "valence": 0.5, "arousal": -0.1}},
    {"emotion": {"category": "resignation", "valence": -0.4, "arousal": -0.4}},
    # confidence gating (low confidence must attenuate identically)
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8,
                 "confidence": 0.2}},
    {"emotion": {"category": "joy", "valence": 0.6, "arousal": 0.4,
                 "confidence": 0.95}},
    # out-of-range inputs must clamp the same way on both sides
    {"emotion": {"category": "anger", "valence": -5.0, "arousal": 5.0}},
    # prosody modulation
    {
        "emotion": {"category": "fear", "valence": -0.5, "arousal": 0.6},
        "prosody": {
            "duration": 1.8, "f0_mean": 210.0, "f0_std": 30.0, "f0_min": 150.0,
            "f0_max": 300.0, "f0_range": 150.0, "intensity_mean": 62.0,
            "intensity_std": 9.0, "intensity_min": 40.0, "intensity_max": 78.0,
            "jitter_local": 0.03, "shimmer_local": 0.09, "hnr_mean": 11.0,
            "voiced_ratio": 0.62, "speech_rate_approx": 5.5,
        },
    },
    {
        "emotion": {"category": "sadness", "valence": -0.5, "arousal": -0.3},
        "prosody": {
            "duration": 3.0, "f0_mean": 120.0, "f0_std": 8.0, "f0_min": 95.0,
            "f0_max": 140.0, "f0_range": 45.0, "intensity_mean": 52.0,
            "intensity_std": 4.0, "intensity_min": 35.0, "intensity_max": 60.0,
            "jitter_local": 0.005, "shimmer_local": 0.02, "hnr_mean": 19.0,
            "voiced_ratio": 0.5, "speech_rate_approx": 2.4,
        },
    },
]

# Hybrid mode has its own arithmetic — a weighted composite, a per-video
# reference, a different confidence rule and a neutral special case — so it
# needs its own parity cases rather than riding on the ones above.
_LOUD = {
    "duration": 2.0, "f0_mean": 300.0, "f0_std": 60.0, "f0_min": 150.0,
    "f0_max": 450.0, "f0_range": 300.0, "intensity_mean": 70.0,
    "intensity_std": 12.0, "intensity_min": 40.0, "intensity_max": 84.0,
    "jitter_local": 0.03, "shimmer_local": 0.13, "hnr_mean": 8.0,
    "voiced_ratio": 0.6, "speech_rate_approx": 70.0,
}
_QUIET = {
    "duration": 3.0, "f0_mean": 110.0, "f0_std": 9.0, "f0_min": 85.0,
    "f0_max": 155.0, "f0_range": 70.0, "intensity_mean": 20.0,
    "intensity_std": 5.0, "intensity_min": -30.0, "intensity_max": 48.0,
    "jitter_local": 0.006, "shimmer_local": 0.04, "hnr_mean": 17.0,
    "voiced_ratio": 0.45, "speech_rate_approx": 28.0,
}
# Out-of-range on every component, so both sides must clamp identically.
_EXTREME = {**_LOUD, "f0_mean": 900.0, "intensity_mean": 400.0,
            "f0_range": 2000.0, "speech_rate_approx": 500.0,
            "jitter_local": 1.0, "shimmer_local": 1.0}
# A feature the pipeline failed to compute — the renormalisation path.
_PARTIAL = {k: v for k, v in _LOUD.items() if k not in ("f0_mean", "f0_range")}

for _cat, _val, _aro in [
    ("anger", -0.7, 0.8), ("joy", 0.7, 0.5), ("sadness", -0.5, -0.4),
    ("fear", -0.5, 0.6), ("surprise", 0.1, 0.7), ("sarcasm", -0.35, 0.15),
    ("sincerity", 0.5, -0.1), ("resignation", -0.4, -0.4),
    ("neutral", 0.0, 0.0),          # must stay grey, not get saturated
]:
    for _pros in (_LOUD, _QUIET, _EXTREME, _PARTIAL):
        CASES.append({
            "emotion": {"category": _cat, "valence": _val, "arousal": _aro},
            "prosody": _pros,
            "mode": "hybrid",
        })

CASES += [
    # per-video reference: relative scoring on both sides
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8},
     "prosody": _LOUD, "reference": _QUIET, "mode": "hybrid"},
    {"emotion": {"category": "joy", "valence": 0.7, "arousal": 0.5},
     "prosody": _QUIET, "reference": _LOUD, "mode": "hybrid"},
    {"emotion": {"category": "joy", "valence": 0.7, "arousal": 0.5},
     "prosody": _LOUD, "reference": _LOUD, "mode": "hybrid"},
    # reference missing the keys it is asked about → falls back per component
    {"emotion": {"category": "fear", "valence": -0.5, "arousal": 0.6},
     "prosody": _LOUD, "reference": {"jitter_local": 0.01}, "mode": "hybrid"},
    # confidence in hybrid mutes colour only — the divergent branch
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8,
                 "confidence": 0.2}, "prosody": _LOUD, "mode": "hybrid"},
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8,
                 "confidence": 0.95}, "prosody": _LOUD, "mode": "hybrid"},
    {"emotion": {"category": "joy", "valence": 0.6, "arousal": 0.4,
                 "confidence": 0.45}, "prosody": _QUIET,
     "reference": _LOUD, "mode": "hybrid"},
    # hybrid asked for with nothing to measure → both must fall back to full_ai
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8},
     "mode": "hybrid"},
    # mode stated explicitly must equal the config default path
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8},
     "prosody": _LOUD, "mode": "full_ai"},
]

# Calibration weights are applied last and stretch around a midpoint, so they
# have their own clamping and their own neutral-colour special case.
_W_BOOST = {"saturation": 1.4, "lightness": 1.4, "size": 1.4, "motion": 1.4}
_W_CUT = {"saturation": 0.6, "lightness": 0.6, "size": 0.6, "motion": 0.6}
_W_MIXED = {"saturation": 0.6, "size": 1.4, "motion": 1.2}   # lightness omitted
_W_EXTREME = {"saturation": 9.0, "lightness": 9.0, "size": 9.0, "motion": 9.0}

for _w in (_W_BOOST, _W_CUT, _W_MIXED, _W_EXTREME):
    for _mode in ("full_ai", "hybrid"):
        for _cat, _val, _aro in [
            ("anger", -0.7, 0.8), ("sadness", -0.5, -0.4), ("joy", 0.7, 0.5),
            ("neutral", 0.0, 0.0),          # weighting must not colour grey
        ]:
            CASES.append({
                "emotion": {"category": _cat, "valence": _val, "arousal": _aro},
                "prosody": _LOUD, "mode": _mode, "weights": _w,
            })

CASES += [
    # weights combined with confidence attenuation — order of operations
    {"emotion": {"category": "anger", "valence": -0.7, "arousal": 0.8,
                 "confidence": 0.2}, "prosody": _LOUD, "mode": "hybrid",
     "weights": _W_BOOST},
    {"emotion": {"category": "joy", "valence": 0.6, "arousal": 0.4,
                 "confidence": 0.5}, "prosody": _QUIET, "reference": _LOUD,
     "mode": "hybrid", "weights": _W_MIXED},
    # an all-neutral weight set must be a no-op on both sides
    {"emotion": {"category": "fear", "valence": -0.5, "arousal": 0.6},
     "prosody": _LOUD, "mode": "hybrid",
     "weights": {"saturation": 1.0, "lightness": 1.0, "size": 1.0,
                 "motion": 1.0}},
]



def _canonical_py(v: dict) -> str:
    """Must mirror `canonical()` in scripts/ts_mapping_probe.ts exactly."""
    def n(x: float) -> str:
        return f"{float(x):.6f}"

    return json.dumps(
        {
            "shape": v["shape"],
            "color": {
                "h": n(v["color"]["h"]),
                "s": n(v["color"]["s"]),
                "l": n(v["color"]["l"]),
            },
            "size": n(v["size"]),
            "motion": {
                "type": v["motion"]["type"],
                "amplitude": n(v["motion"]["amplitude"]),
                "speed": n(v["motion"]["speed"]),
            },
        },
        separators=(",", ":"),
    )


@pytest.mark.skipif(
    not TSX.exists() or shutil.which("node") is None,
    reason="frontend toolchain not installed (npm install in frontend/)",
)
def test_python_and_typescript_mappings_are_byte_identical():
    proc = subprocess.run(
        [str(TSX), "scripts/mapping_probe.ts"],
        input=json.dumps(CASES),
        capture_output=True,
        text=True,
        cwd=str(FRONTEND),
        timeout=180,
    )
    assert proc.returncode == 0, f"TS probe failed:\n{proc.stderr[-2000:]}"

    ts_lines = [l for l in proc.stdout.strip().split("\n") if l.strip()]
    assert len(ts_lines) == len(CASES), (
        f"expected {len(CASES)} results, got {len(ts_lines)}"
    )

    mismatches = []
    for i, (case, ts_out) in enumerate(zip(CASES, ts_lines)):
        py_out = _canonical_py(
            map_emotion_to_visual(
                case["emotion"],
                case.get("prosody"),
                case.get("reference"),
                case.get("mode"),
                case.get("weights"),
            )
        )
        if py_out != ts_out:
            mismatches.append(
                f"case {i} ({case['emotion']['category']}, "
                f"mode={case.get('mode', 'config default')}):\n"
                f"  python: {py_out}\n"
                f"  ts    : {ts_out}"
            )

    assert not mismatches, (
        f"{len(mismatches)}/{len(CASES)} cases diverge between "
        "Python and TypeScript:\n\n" + "\n\n".join(mismatches)
    )
