"""Audio I/O — normalize any media to 16 kHz mono PCM WAV and slice it.

Whisper, Parselmouth, and wav2vec 2.0 all prefer (and in some cases require)
16 kHz mono PCM. This module wraps FFmpeg with a single normalization
entry point so the rest of the pipeline never has to think about formats.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import soundfile as sf

SAMPLE_RATE = 16_000


@dataclass
class NormalizationResult:
    path: Path
    duration: float  # seconds
    sample_rate: int


def normalize_to_wav(
    input_path: str | Path,
    out_dir: Optional[Path] = None,
) -> NormalizationResult:
    """Convert any media file to 16 kHz mono PCM WAV.

    Args:
        input_path: Source media file (MP4, MP3, MKV, AAC, WAV, etc.).
        out_dir: Where to write the converted WAV. Defaults to a temp dir.

    Returns:
        NormalizationResult with the output path + duration in seconds.
    """
    input_path = Path(input_path)
    if not input_path.exists():
        raise FileNotFoundError(f"No such file: {input_path}")

    out_dir = out_dir or Path(tempfile.mkdtemp(prefix="soundshape_"))
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{input_path.stem}__16k_mono.wav"

    # -y         overwrite
    # -vn        drop video
    # -ac 1      mono
    # -ar 16000  16 kHz
    # -acodec pcm_s16le   16-bit PCM little-endian
    cmd = [
        "ffmpeg",
        "-y",
        "-i", str(input_path),
        "-vn",
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-acodec", "pcm_s16le",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (exit {result.returncode}):\n{result.stderr}"
        )

    info = sf.info(str(out_path))
    return NormalizationResult(
        path=out_path,
        duration=float(info.duration),
        sample_rate=int(info.samplerate),
    )


def slice_to_temp_wav(
    wav_path: str | Path,
    start_sec: float,
    end_sec: float,
) -> Path:
    """Cut [start, end] from a WAV into a new temporary WAV.

    Uses soundfile (numpy-backed) — much faster than spawning ffmpeg per
    segment. Caller is responsible for cleaning up the returned path.
    """
    wav_path = Path(wav_path)
    signal, sr = sf.read(str(wav_path))
    if signal.ndim > 1:
        signal = signal.mean(axis=1)

    start_idx = max(0, int(start_sec * sr))
    end_idx = min(len(signal), int(end_sec * sr))
    if end_idx <= start_idx:
        raise ValueError(
            f"Empty slice ({start_sec:.3f}..{end_sec:.3f}s) of audio with "
            f"duration {len(signal)/sr:.3f}s"
        )

    chunk = signal[start_idx:end_idx].astype(np.float32, copy=False)
    fd, tmp_path = tempfile.mkstemp(prefix="soundshape_slice_", suffix=".wav")
    # mkstemp returns an open fd; close it before soundfile writes.
    import os
    os.close(fd)
    sf.write(tmp_path, chunk, sr, subtype="PCM_16")
    return Path(tmp_path)


def safe_unlink(path: Path) -> None:
    """Delete a temp file if it exists. Errors are swallowed."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def cleanup_dir(dir_path: Path) -> None:
    """Recursively delete a directory (typically the temp dir from normalize)."""
    if dir_path.exists():
        shutil.rmtree(dir_path, ignore_errors=True)
