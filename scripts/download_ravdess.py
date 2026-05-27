"""Download a subset of the RAVDESS speech dataset.

RAVDESS (Ryerson Audio-Visual Database of Emotional Speech and Song) is the
academic-standard benchmark for emotional speech: 24 actors, 8 emotions, two
fixed sentences. We use it to validate that prosody features actually
discriminate between emotions.

This script downloads the speech-only zip (~209 MB) from Zenodo, extracts
only the actors we ask for (default: Actor_01 male + Actor_02 female,
~120 files / ~20 MB total), and removes the zip when done.

Idempotent: re-running with the same actors is a no-op.

Usage:
    python scripts/download_ravdess.py                  # actors 01, 02
    python scripts/download_ravdess.py --actors 01 03   # specific actors
    python scripts/download_ravdess.py --all            # all 24 actors
"""

from __future__ import annotations

import argparse
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ZENODO_URL = (
    "https://zenodo.org/records/1188976/files/"
    "Audio_Speech_Actors_01-24.zip?download=1"
)
ZIP_SIZE_MB = 209
DEFAULT_ACTORS = ["01", "02"]

REPO_ROOT = Path(__file__).resolve().parent.parent
TARGET_DIR = REPO_ROOT / "data" / "datasets" / "RAVDESS"


def download_with_progress(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url} → {dest.name}")
    last_pct = -1

    def hook(blocks: int, block_size: int, total_size: int) -> None:
        nonlocal last_pct
        if total_size <= 0:
            return
        downloaded = blocks * block_size
        pct = min(100, int(downloaded * 100 / total_size))
        if pct != last_pct and pct % 2 == 0:
            mb = downloaded / 1024 / 1024
            total_mb = total_size / 1024 / 1024
            bar = "█" * (pct // 5) + "·" * (20 - pct // 5)
            sys.stdout.write(
                f"\r  [{bar}] {pct:3d}%  {mb:6.1f} / {total_mb:6.1f} MB"
            )
            sys.stdout.flush()
            last_pct = pct

    urllib.request.urlretrieve(url, dest, reporthook=hook)
    print()  # newline after progress bar


def extract_actors(zip_path: Path, target_dir: Path, actors: list[str]) -> int:
    """Extract only the given actor folders from the zip. Returns file count."""
    target_dir.mkdir(parents=True, exist_ok=True)
    wanted_prefixes = tuple(f"Actor_{a}/" for a in actors)

    extracted = 0
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.namelist():
            # The zip stores files at the top level as `Actor_NN/*.wav`,
            # no parent directory wrapping.
            if not member.endswith(".wav"):
                continue
            if not member.startswith(wanted_prefixes):
                continue
            out_path = target_dir / member
            if out_path.exists():
                continue
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, open(out_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            extracted += 1
    return extracted


def already_present(actors: list[str]) -> bool:
    for a in actors:
        d = TARGET_DIR / f"Actor_{a}"
        if not d.exists() or not any(d.glob("*.wav")):
            return False
    return True


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--actors",
        nargs="+",
        default=DEFAULT_ACTORS,
        help="Actor IDs to extract (e.g. 01 02). Default: 01 02.",
    )
    p.add_argument(
        "--all",
        action="store_true",
        help="Download and extract all 24 actors (~200 MB extracted).",
    )
    p.add_argument(
        "--keep-zip",
        action="store_true",
        help="Don't delete the downloaded zip after extracting.",
    )
    args = p.parse_args()

    actors = [f"{i:02d}" for i in range(1, 25)] if args.all else args.actors
    print(f"Target actors: {', '.join(actors)}")

    if already_present(actors):
        print(f"All requested actors already extracted under {TARGET_DIR}. Nothing to do.")
        return 0

    zip_path = TARGET_DIR / "_Audio_Speech_Actors_01-24.zip"
    if not zip_path.exists():
        download_with_progress(ZENODO_URL, zip_path)
    else:
        print(f"Reusing existing zip: {zip_path.name}")

    print(f"Extracting requested actors to {TARGET_DIR}…")
    count = extract_actors(zip_path, TARGET_DIR, actors)
    print(f"Extracted {count} new .wav files.")

    if not args.keep_zip:
        zip_path.unlink()
        print("Removed zip.")

    # Final summary
    for a in actors:
        d = TARGET_DIR / f"Actor_{a}"
        n = len(list(d.glob("*.wav"))) if d.exists() else 0
        print(f"  Actor_{a}: {n} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
