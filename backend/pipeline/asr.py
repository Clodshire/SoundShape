"""Automatic speech recognition — OpenAI Whisper with word-level timestamps.

Whisper outputs both (a) coarse "segments" (paragraph-scale chunks the
decoder produces naturally) and (b) per-word timestamps when requested.
SoundShape uses the segments as the unit of emotion analysis (one
subtitle = one emotion read) and the per-word timestamps for tight
subtitle sync.

For Phase 4 MVP we default to the `base` model (74 MB, fast). Phase 5
will switch the default to `large-v3-turbo` for accuracy.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import List, Optional

import whisper

DEFAULT_MODEL = "base"


@dataclass
class Word:
    word: str
    start: float
    end: float
    probability: float

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TranscriptionSegment:
    start: float
    end: float
    text: str
    words: List[Word] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "start": self.start,
            "end": self.end,
            "text": self.text,
            "words": [w.to_dict() for w in self.words],
        }


@dataclass
class Transcription:
    text: str
    language: str
    segments: List[TranscriptionSegment]

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "language": self.language,
            "segments": [s.to_dict() for s in self.segments],
        }


@lru_cache(maxsize=2)
def _load_model(model_size: str):
    return whisper.load_model(model_size)


def transcribe(
    wav_path: str,
    language: Optional[str] = None,
    model_size: str = DEFAULT_MODEL,
) -> Transcription:
    """Transcribe a WAV file with per-segment + per-word timestamps."""
    model = _load_model(model_size)
    result = model.transcribe(
        wav_path,
        language=language,
        word_timestamps=True,
        fp16=False,  # MPS/CPU friendly; Whisper warns otherwise
        verbose=False,
    )

    segments: List[TranscriptionSegment] = []
    for seg in result.get("segments", []):
        words = [
            Word(
                word=w["word"].strip(),
                start=float(w["start"]),
                end=float(w["end"]),
                probability=float(w.get("probability", 0.0)),
            )
            for w in seg.get("words", [])
        ]
        segments.append(
            TranscriptionSegment(
                start=float(seg["start"]),
                end=float(seg["end"]),
                text=str(seg["text"]).strip(),
                words=words,
            )
        )

    return Transcription(
        text=str(result.get("text", "")).strip(),
        language=str(result.get("language", "")),
        segments=segments,
    )


if __name__ == "__main__":
    import sys
    from pprint import pprint

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.asr <wav_path>")
        sys.exit(1)

    t = transcribe(sys.argv[1])
    print(f"Language: {t.language}")
    print(f"Full text: {t.text}\n")
    for i, seg in enumerate(t.segments):
        print(f"[{seg.start:6.2f}-{seg.end:6.2f}] {seg.text}")
        for w in seg.words[:6]:
            print(f"    {w.start:6.2f}-{w.end:6.2f}  {w.word!r}")
        if len(seg.words) > 6:
            print(f"    … +{len(seg.words) - 6} more words")
