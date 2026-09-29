"""Split the track into voice and music, and analyse only the voice.

Loud background music destabilising the acoustic features is a limitation the
project states about itself; reading the separated vocals instead is the direct
fix. Measured on RAVDESS with music mixed in at equal level, emotion accuracy
recovers from 60.8% to 71.5% (p < 0.001) — close to the 73.5% ceiling of the
clean recordings.

The music half is discarded. An earlier version rendered it as a coloured
border around the picture, which was removed: the project's own argument for
adding a haptic channel is that the VISUAL channel is already saturated —
face, captions, emotion glyph — and a fourth visual element contradicts that.
Separation is kept purely for what it does to accuracy.

Model is HDemucs (Defossez et al. 2021) via the torchaudio bundle, so nothing
new has to be installed. It wants 44.1 kHz stereo, which is why separation
happens before the 16 kHz mono conversion the rest of the pipeline uses.

Measured on an M3 MacBook Air, 52 s clip: 10.1 s on CPU (5.2x faster than
real time), 11.9 s on MPS. MPS is slower for this model size on unified
memory — see separation_config.device.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = REPO / "config" / "separation_config.json"

# HDemucs splits into four stems. Everything that is not the voice counts as
# "music" for our purposes — drums and bass carry as much of a cue's arousal as
# the melody does.
VOCAL_STEM = "vocals"


def load_config() -> Dict[str, Any]:
    """Read the separation config (uncached, so edits apply without a restart)."""
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a bad config must not break serving
        return {"enabled": False}


def is_enabled() -> bool:
    return bool(load_config().get("enabled", False))


@dataclass
class SeparationResult:
    """Two mono 44.1 kHz tracks, plus why the decision went the way it did."""

    vocals: np.ndarray
    music: np.ndarray
    sample_rate: int
    music_present: bool
    music_energy_ratio: float
    skipped: bool = False

    @property
    def duration(self) -> float:
        return len(self.vocals) / self.sample_rate if self.sample_rate else 0.0


@lru_cache(maxsize=1)
def _model():
    """Load HDemucs once. ~319 MB, downloaded on first use."""
    import torch
    from torchaudio.pipelines import HDEMUCS_HIGH_MUSDB_PLUS

    cfg = load_config()
    bundle = HDEMUCS_HIGH_MUSDB_PLUS
    model = bundle.get_model()
    device = cfg.get("device", "cpu")
    model.to(device).eval()
    torch.set_grad_enabled(False)
    return model, bundle.sample_rate, device, list(model.sources)


def _rms(x: np.ndarray) -> float:
    if x.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def music_energy_ratio(music: np.ndarray, mixture: np.ndarray) -> float:
    """How much of the track's energy is not voice, in [0, 1]-ish.

    Compared against the mixture rather than against the vocals, so a quiet
    passage with no one speaking does not read as "all music".
    """
    denom = _rms(mixture)
    if denom <= 1e-9:
        return 0.0
    return _rms(music) / denom


def separate_array(
    wav: np.ndarray, sample_rate: int
) -> Tuple[np.ndarray, np.ndarray]:
    """Split one (channels, samples) float array into (vocals, music), mono.

    Chunked so memory stays flat on long inputs and so a caller can interleave
    the work with streaming playback.
    """
    import torch

    model, model_sr, device, sources = _model()
    if sample_rate != model_sr:
        raise ValueError(
            f"separation expects {model_sr} Hz, got {sample_rate} — "
            "use audio_io.extract_for_separation"
        )
    if wav.ndim == 1:
        wav = np.stack([wav, wav], axis=0)

    cfg = load_config()
    chunk = int(float(cfg.get("chunk_seconds", 30.0)) * model_sr)
    vocal_idx = sources.index(VOCAL_STEM)

    x = torch.from_numpy(np.ascontiguousarray(wav, dtype=np.float32))
    vocals_out, music_out = [], []
    for start in range(0, x.shape[1], chunk):
        piece = x[:, start : start + chunk].to(device)
        if piece.shape[1] == 0:
            break
        # The model was trained on standardised input; skipping this makes the
        # separation noticeably worse on quiet material.
        ref = piece.mean(0)
        std = ref.std() or 1.0
        normed = ((piece - ref.mean()) / std)[None]
        # Inference only — without no_grad, torch tracks gradients (slower,
        # more memory) and .numpy() refuses the result outright.
        with torch.no_grad():
            stems = model(normed)[0] * std + ref.mean()
        stems = stems.cpu().numpy()
        vocals = stems[vocal_idx]
        music = stems.sum(axis=0) - vocals
        vocals_out.append(vocals.mean(axis=0))
        music_out.append(music.mean(axis=0))

    if not vocals_out:
        empty = np.zeros(0, dtype=np.float32)
        return empty, empty
    return (
        np.concatenate(vocals_out).astype(np.float32),
        np.concatenate(music_out).astype(np.float32),
    )


def separate_file(path: str | Path) -> Optional[SeparationResult]:
    """Separate a 44.1 kHz stereo WAV. None when disabled or unusable.

    Most clips people try have no score at all, so the first
    `music_probe_seconds` are separated and measured before committing to the
    whole file. Below the energy threshold the rest is skipped — by far the
    largest saving available, and it costs nothing on material that does have
    music.
    """
    import soundfile as sf

    cfg = load_config()
    if not cfg.get("enabled", False):
        return None

    try:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    except Exception:  # noqa: BLE001
        logger.exception("separation: could not read %s", path)
        return None

    duration = len(data) / sr if sr else 0.0
    if duration > float(cfg.get("max_seconds", 3600.0)):
        logger.warning("separation: %.0fs exceeds max_seconds, skipping", duration)
        return None

    wav = data.T  # (channels, samples)
    mixture_mono = wav.mean(axis=0)

    probe_len = int(float(cfg.get("music_probe_seconds", 20.0)) * sr)
    probe = wav[:, :probe_len] if probe_len else wav
    try:
        probe_vocals, probe_music = separate_array(probe, sr)
    except Exception:  # noqa: BLE001 — never let this break analysis
        logger.exception("separation failed on probe; continuing without it")
        return None

    ratio = music_energy_ratio(probe_music, probe[:, : len(probe_music)].mean(axis=0))
    threshold = float(cfg.get("music_energy_ratio_min", 0.08))
    if ratio < threshold:
        # Speech-only material: the vocals track would be the mixture anyway.
        return SeparationResult(
            vocals=mixture_mono.astype(np.float32),
            music=np.zeros(0, dtype=np.float32),
            sample_rate=sr,
            music_present=False,
            music_energy_ratio=ratio,
            skipped=True,
        )

    if probe_len and probe_len < wav.shape[1]:
        rest_vocals, rest_music = separate_array(wav[:, probe_len:], sr)
        vocals = np.concatenate([probe_vocals, rest_vocals])
        music = np.concatenate([probe_music, rest_music])
    else:
        vocals, music = probe_vocals, probe_music

    return SeparationResult(
        vocals=vocals,
        music=music,
        sample_rate=sr,
        music_present=True,
        music_energy_ratio=ratio,
    )


# ── pipeline entry point ─────────────────────────────────────────────


@dataclass
class PreparedAudio:
    """What the rest of the pipeline should read.

    `wav_path` is always usable: when separation is off, skipped or failed it is
    simply the file the caller already had. Callers therefore never branch on
    whether separation happened — they just read `wav_path`. The remaining
    fields are for logging and for the response metadata.
    """

    wav_path: Path
    separated: bool
    music_present: bool
    music_energy_ratio: float = 0.0


def _write_16k_mono(samples: np.ndarray, sr: int, out_path: Path) -> Path:
    """Resample a separated track to what Whisper and Parselmouth expect."""
    import soundfile as sf
    import torch
    import torchaudio

    from backend.pipeline import audio_io

    target = audio_io.SAMPLE_RATE
    tensor = torch.from_numpy(np.ascontiguousarray(samples, dtype=np.float32))
    if sr != target:
        tensor = torchaudio.functional.resample(tensor, sr, target)
    sf.write(str(out_path), tensor.numpy(), target)
    return out_path


def prepare(
    media_path: str | Path,
    fallback_wav: str | Path,
    out_dir: Optional[Path] = None,
) -> PreparedAudio:
    """Separate if switched on, and report what came of it.

    Never raises. Separation is an enhancement; a video it cannot handle must
    still be analysed exactly the way it was before the feature existed.
    """
    fallback = PreparedAudio(
        wav_path=Path(fallback_wav),
        separated=False,
        music_present=False,
    )
    if not is_enabled():
        return fallback

    try:
        from backend.pipeline import audio_io

        stereo = audio_io.extract_for_separation(media_path, out_dir=out_dir)
        result = separate_file(stereo.path)
        audio_io.safe_unlink(stereo.path)
        if result is None:
            return fallback

        # Speech-only material: the vocals track IS the mixture, so writing it
        # out again would cost a resample for no gain.
        if result.skipped or not load_config().get("keep_vocals_for_prosody", True):
            return PreparedAudio(
                wav_path=Path(fallback_wav),
                separated=False,
                music_present=result.music_present,
                music_energy_ratio=result.music_energy_ratio,
            )

        target_dir = Path(out_dir) if out_dir else Path(fallback_wav).parent
        vocals_path = _write_16k_mono(
            result.vocals, result.sample_rate, target_dir / "vocals__16k_mono.wav"
        )
        return PreparedAudio(
            wav_path=vocals_path,
            separated=True,
            music_present=result.music_present,
            music_energy_ratio=result.music_energy_ratio,
        )
    except Exception:  # noqa: BLE001 — never let an enhancement break analysis
        logger.exception("separation: prepare failed, continuing without it")
        return fallback

