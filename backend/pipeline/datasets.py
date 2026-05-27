"""Dataset-specific utilities for exploration notebooks.

RAVDESS naming convention (audio-only speech):

    03-01-{emotion}-{intensity}-{statement}-{repetition}-{actor}.wav

Where each numeric field decodes per Livingstone & Russo (2018):
  modality:     01 full-AV, 02 video-only, 03 audio-only
  vocal channel: 01 speech, 02 song
  emotion:      01 neutral, 02 calm, 03 happy, 04 sad,
                05 angry, 06 fearful, 07 disgust, 08 surprised
  intensity:    01 normal, 02 strong  (neutral has no "strong")
  statement:    01 "Kids are talking by the door"
                02 "Dogs are sitting by the door"
  repetition:   01 first, 02 second
  actor:        01–24 (odd = male, even = female)
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple

RAVDESS_EMOTION_MAP = {
    "01": "neutral",
    "02": "calm",
    "03": "happy",
    "04": "sad",
    "05": "angry",
    "06": "fearful",
    "07": "disgust",
    "08": "surprised",
}

RAVDESS_INTENSITY_MAP = {"01": "normal", "02": "strong"}

RAVDESS_STATEMENT_MAP = {
    "01": "Kids are talking by the door",
    "02": "Dogs are sitting by the door",
}


class RavdessClip(NamedTuple):
    path: Path
    actor: str
    actor_sex: str
    emotion: str
    intensity: str
    statement: str
    repetition: str


def parse_ravdess_filename(path: Path) -> RavdessClip:
    parts = path.stem.split("-")
    if len(parts) != 7:
        raise ValueError(f"Not a RAVDESS filename: {path.name}")
    actor = parts[6]
    return RavdessClip(
        path=path,
        actor=actor,
        actor_sex="male" if int(actor) % 2 == 1 else "female",
        emotion=RAVDESS_EMOTION_MAP[parts[2]],
        intensity=RAVDESS_INTENSITY_MAP[parts[3]],
        statement=RAVDESS_STATEMENT_MAP[parts[4]],
        repetition=parts[5],
    )


def load_ravdess_clips(root: Path) -> list[RavdessClip]:
    """Discover all RAVDESS .wav files under `root/Actor_*/`."""
    clips: list[RavdessClip] = []
    for wav_path in sorted(root.glob("Actor_*/*.wav")):
        try:
            clips.append(parse_ravdess_filename(wav_path))
        except (ValueError, KeyError):
            continue
    return clips
