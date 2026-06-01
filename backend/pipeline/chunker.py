"""Silence-aligned chunking for streaming/progressive processing.

Whisper processes audio in ~30s windows, so the efficient streaming unit is
~25-30s. But cutting at a hard time boundary risks slicing mid-word, which
would split an utterance across chunks and disrupt the emotion read. Instead
we cut at **silence gaps** near the target length (people pause between
sentences, so silence ≈ sentence boundary). This is the streaming-friendly
form of "group whole lines until they exceed ~30s" — achieved without needing
the transcript first.

Silence is detected from frame-wise RMS energy (no extra model dependency).
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

import numpy as np
import soundfile as sf

TARGET_SEC = 25.0      # grow a chunk to at least this before looking to cut
FIRST_TARGET_SEC = 10.0  # the FIRST chunk is short → fast prebuffer / quick start
HARD_CAP_SEC = 40.0    # force a cut by here even with no silence (e.g. singing)
MIN_SILENCE_SEC = 0.18  # a gap must be this long to count as a sentence break
FRAME_MS = 25
HOP_MS = 10


def find_chunk_boundaries(
    wav_path: str | Path,
    target_sec: float = TARGET_SEC,
    hard_cap_sec: float = HARD_CAP_SEC,
    min_silence_sec: float = MIN_SILENCE_SEC,
    first_target_sec: float = FIRST_TARGET_SEC,
) -> List[Tuple[float, float]]:
    """Return [(start, end), ...] in seconds, cutting at silence near target.

    The first chunk uses `first_target_sec` (short) so playback can start after
    a small prebuffer; subsequent chunks use the larger `target_sec` for
    throughput, since by then processing runs ahead of the playhead.
    """
    sig, sr = sf.read(str(wav_path))
    if sig.ndim > 1:
        sig = sig.mean(axis=1)
    sig = sig.astype(np.float32)
    duration = len(sig) / sr
    if duration <= target_sec:
        return [(0.0, duration)]

    # Frame-wise RMS energy.
    frame = max(1, int(sr * FRAME_MS / 1000))
    hop = max(1, int(sr * HOP_MS / 1000))
    n_frames = 1 + max(0, (len(sig) - frame) // hop)
    rms = np.empty(n_frames, dtype=np.float32)
    for i in range(n_frames):
        seg = sig[i * hop : i * hop + frame]
        rms[i] = np.sqrt(np.mean(seg * seg) + 1e-12)

    # Relative silence threshold: 15% of the "loud" level (95th percentile).
    loud = float(np.percentile(rms, 95))
    thr = max(loud * 0.15, 1e-6)
    is_sil = rms < thr

    # Centers (sec) of silence runs that are long enough to be a sentence break.
    sil_centers: List[float] = []
    i = 0
    min_frames = int(min_silence_sec * 1000 / HOP_MS)
    while i < n_frames:
        if is_sil[i]:
            j = i
            while j < n_frames and is_sil[j]:
                j += 1
            if (j - i) >= min_frames:
                sil_centers.append(((i + j) / 2.0) * hop / sr)
            i = j
        else:
            i += 1

    # Build chunks: grow to target, cut at first qualifying silence, else cap.
    bounds: List[Tuple[float, float]] = []
    start = 0.0
    first = True
    while start < duration - 1e-3:
        tgt = first_target_sec if first else target_sec
        first = False
        # Don't bother with a tiny final chunk: if the remainder fits in one
        # capped chunk, take it whole.
        if duration - start <= hard_cap_sec:
            bounds.append((start, duration))
            break
        target_end = start + tgt
        cut = None
        for c in sil_centers:
            if c >= target_end and c <= start + hard_cap_sec:
                cut = c
                break
        if cut is None:
            cut = start + hard_cap_sec
        bounds.append((start, cut))
        start = cut
    return bounds


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.chunker <wav>")
        sys.exit(1)
    for s, e in find_chunk_boundaries(sys.argv[1]):
        print(f"  chunk {s:7.2f} – {e:7.2f}   ({e - s:.2f}s)")
