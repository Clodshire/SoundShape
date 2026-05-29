"""Sync the canonical mapping config into the frontend bundle.

The cross-modal mapping rules live in ONE canonical file:
    config/mapping_config.json

The Python backend reads that file directly. The Next.js frontend, however,
bundles its imports at build time, so it needs a copy inside its source tree:
    frontend/src/config/mapping_config.json

Run this whenever you edit the canonical config:
    python scripts/sync_mapping_config.py

It copies the file and verifies the two are byte-identical.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CANONICAL = REPO_ROOT / "config" / "mapping_config.json"
FRONTEND_COPY = REPO_ROOT / "frontend" / "src" / "config" / "mapping_config.json"


def main() -> int:
    if not CANONICAL.exists():
        print(f"ERROR: canonical config missing at {CANONICAL}", file=sys.stderr)
        return 1

    FRONTEND_COPY.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(CANONICAL, FRONTEND_COPY)

    if CANONICAL.read_bytes() != FRONTEND_COPY.read_bytes():
        print("ERROR: copy mismatch after sync", file=sys.stderr)
        return 1

    print(f"Synced {CANONICAL.relative_to(REPO_ROOT)} → "
          f"{FRONTEND_COPY.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
