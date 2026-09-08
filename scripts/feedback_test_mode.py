"""Loosen the feedback-prompt thresholds so the loop can be demoed on demand.

In normal operation a prompt appears only when the classifier's confidence is
below `trigger_below` (0.45), at most every `min_interval_seconds` (120). That
is right for a viewer and useless for a demo: on a short clip you may see no
prompt at all, and you cannot rehearse a presentation on "maybe".

Test mode raises the trigger so nearly every segment qualifies and shortens the
interval, without touching anything else — same code path, same store, same
endpoints. Only the two pacing numbers change.

    python scripts/feedback_test_mode.py on     # demo/rehearsal
    python scripts/feedback_test_mode.py off    # back to real thresholds
    python scripts/feedback_test_mode.py status

The config is read uncached on every request, so switching takes effect
immediately — no server restart.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CONFIG = REPO / "config" / "feedback_config.json"

# What test mode overrides, and the shipping values to restore.
TEST = {"trigger_below": 0.99, "min_interval_seconds": 5, "max_prompts_per_video": 20}
REAL = {"trigger_below": 0.45, "min_interval_seconds": 120, "max_prompts_per_video": 5}


def apply(values: dict) -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg.update(values)
    # Keys order is preserved by json.loads/dumps round-trip, so the file stays
    # readable and diffs stay small.
    CONFIG.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def show() -> None:
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    now = {k: cfg.get(k) for k in REAL}
    mode = "TEST" if now == TEST else "REAL" if now == REAL else "CUSTOM"
    print(f"mode: {mode}")
    for k, v in now.items():
        print(f"  {k}: {v}")


def main() -> int:
    arg = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if arg == "on":
        apply(TEST)
        print("test mode ON — 거의 모든 구간에서 질문 카드가 뜹니다.")
    elif arg == "off":
        apply(REAL)
        print("test mode OFF — 실제 임계값(0.45 / 120초)으로 복구했습니다.")
    elif arg == "status":
        pass
    else:
        print(__doc__)
        return 2
    show()
    return 0


if __name__ == "__main__":
    sys.exit(main())
