"""Automatic speech recognition — faster-whisper (CTranslate2) + word timestamps.

Whisper is the de-facto open-source ASR model (free, multilingual, strong on
Korean). We run it through **faster-whisper** (CTranslate2 backend) which is
~4x faster and lighter than the reference `openai-whisper`, so we can afford
the high-accuracy **large-v3-turbo** model on CPU.

Outputs coarse segments (one subtitle = one emotion read) + per-word timestamps
(for karaoke caption sync). The built-in VAD filter trims silence so Whisper
doesn't hallucinate text over non-speech.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import List, Optional

from faster_whisper import WhisperModel

# Most accurate practical model. Fallbacks if a weight set can't be fetched.
DEFAULT_MODEL = "large-v3-turbo"
_FALLBACKS = ["large-v3-turbo", "large-v3", "small", "base"]


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
def _load_model(model_size: str) -> WhisperModel:
    """Load a faster-whisper model, falling back to smaller ones if needed.

    int8 on CPU is the fast/accurate sweet spot on Apple Silicon (CTranslate2
    has no Metal backend, so we stay on CPU).
    """
    order = [model_size] + [m for m in _FALLBACKS if m != model_size]
    last_err: Optional[Exception] = None
    for name in order:
        try:
            model = WhisperModel(name, device="cpu", compute_type="int8")
            if name != model_size:
                # Surface the fallback so it's visible in logs.
                print(f"[asr] requested {model_size!r} unavailable; using {name!r}")
            return model
        except Exception as e:  # noqa: BLE001
            last_err = e
            continue
    raise RuntimeError(f"Could not load any Whisper model: {last_err}")


def transcribe(
    wav_path: str,
    language: Optional[str] = None,
    model_size: str = DEFAULT_MODEL,
) -> Transcription:
    """Transcribe a WAV with per-segment + per-word timestamps."""
    model = _load_model(model_size)
    segments_iter, info = model.transcribe(
        wav_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,  # built-in Silero VAD: skip silence/non-speech
        beam_size=5,
    )

    segments: List[TranscriptionSegment] = []
    all_text: List[str] = []
    for seg in segments_iter:  # generator — iterating runs the transcription
        words: List[Word] = []
        for w in seg.words or []:
            words.append(
                Word(
                    word=w.word.strip(),
                    start=float(w.start),
                    end=float(w.end),
                    probability=float(getattr(w, "probability", 0.0)),
                )
            )
        text = str(seg.text).strip()
        all_text.append(text)
        segments.append(
            TranscriptionSegment(
                start=float(seg.start),
                end=float(seg.end),
                text=text,
                words=words,
            )
        )

    return Transcription(
        text=" ".join(all_text).strip(),
        language=str(info.language),
        segments=segments,
    )


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.asr <wav_path> [model_size]")
        sys.exit(1)
    size = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MODEL
    t = transcribe(sys.argv[1], model_size=size)
    print(f"Language: {t.language}")
    print(f"Full text: {t.text}\n")
    for seg in t.segments:
        print(f"[{seg.start:6.2f}-{seg.end:6.2f}] {seg.text}")
