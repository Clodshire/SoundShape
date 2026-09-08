"""Prompt pacing rules (frontend PromptPacer), exercised through a tsx probe.

Pacing is what separates a prompt people tolerate from one they turn the
feature off over, so the rules deserve tests even though they live in
TypeScript. The class takes `now` as an argument, so these are deterministic.

Skipped when the frontend toolchain isn't installed, keeping the suite runnable
in a backend-only environment.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent.parent
FRONTEND = REPO / "frontend"
TSX = FRONTEND / "node_modules" / ".bin" / "tsx"


@pytest.fixture(scope="module")
def probe() -> dict:
    if not TSX.exists() or shutil.which("node") is None:
        pytest.skip("frontend toolchain not installed (npm install in frontend/)")
    proc = subprocess.run(
        [str(TSX), "scripts/pacer_probe.ts"],
        capture_output=True, text=True, cwd=str(FRONTEND), timeout=180,
    )
    assert proc.returncode == 0, f"probe failed:\n{proc.stderr[-2000:]}"
    return json.loads(proc.stdout.strip().split("\n")[-1])


def test_never_asks_twice_about_the_same_moment(probe):
    assert probe["no_repeat"]["first"] is True
    assert probe["no_repeat"]["second"] is False


def test_respects_minimum_interval(probe):
    assert probe["interval"]["tooSoon"] is False
    assert probe["interval"]["justRight"] is True


def test_respects_per_video_cap(probe):
    assert probe["cap"]["allowed"] == 3
    assert probe["cap"]["shown"] == [True, True, True, False, False]


def test_new_video_restores_budget(probe):
    assert probe["reset"]["blockedBefore"] is False
    assert probe["reset"]["allowedAfter"] is True
