"""Pipeline orchestrator — audio file → JSON timeline.

This is the integration point Phase 4 hinges on. Every backend module
built so far (audio_io, asr, prosody, emotion) is composed here into
the single function the FastAPI endpoint exposes.

Output schema (matches docs/03_ARCHITECTURE.md §4):

    {
      "metadata": {
        "duration": float,
        "sample_rate": 16000,
        "language": str,
      },
      "segments": [
        {
          "t": float,            # start time in seconds
          "duration": float,
          "text": str,           # subtitle line
          "words": [{word, start, end, probability}],
          "prosody": {...},      # 15 prosodic features
          "emotion": {
            "category": str,     # "anger" | "joy" | "neutral" | "sadness"
            "category_short": str,  # "ang" | "hap" | "neu" | "sad"
            "category_confidence": float,
            "valence": float,    # [-1, +1]
            "arousal": float,
            "dominance": float | null,
          },
        }
      ]
    }

The frontend's `Emotion` type uses the long form ("anger", "sadness", …),
which is what its `mapEmotionToVisual` rule set expects. We expose the
short code too so debug panels can show both.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from backend.mapping.engine import map_emotion_to_visual
from backend.pipeline import audio_io, asr
from backend.pipeline.emotion import classify_emotion
from backend.pipeline.prosody import extract_prosody

logger = logging.getLogger(__name__)

# Map the categorical model's short codes to the frontend's
# `EmotionCategory` enum values (see frontend/src/types/emotion.ts).
SHORT_TO_LONG = {
    "ang": "anger",
    "hap": "joy",
    "neu": "neutral",
    "sad": "sadness",
}


def build_timeline(
    input_path: str | Path,
    language: Optional[str] = None,
    model_size: str = "large-v3-turbo",
) -> dict:
    """Run the full SoundShape pipeline on an audio or video file.

    Args:
        input_path: Source media file. Any FFmpeg-readable format.
        language: ISO 639-1 language hint for Whisper (e.g. "en", "ko").
                  None = auto-detect.
        model_size: faster-whisper model. "large-v3-turbo" = best accuracy.

    Returns:
        JSON-serializable dict with metadata + segments[].
    """
    input_path = Path(input_path)
    logger.info("build_timeline: %s", input_path)

    # 1. Normalize to 16 kHz mono WAV.
    norm = audio_io.normalize_to_wav(input_path)
    wav_path = norm.path
    work_dir = wav_path.parent  # tempdir created by normalize_to_wav
    logger.info(
        "Normalized to %s (%.2fs @ %d Hz)",
        wav_path,
        norm.duration,
        norm.sample_rate,
    )

    temp_slices: list[Path] = []
    try:
        # 2. Whisper transcription with word timestamps.
        transcription = asr.transcribe(
            str(wav_path), language=language, model_size=model_size
        )
        logger.info(
            "Whisper produced %d segments in %r",
            len(transcription.segments),
            transcription.language,
        )

        # 3. Per-segment prosody + emotion.
        segments_out: list[dict] = []
        for i, seg in enumerate(transcription.segments):
            duration = seg.end - seg.start
            if duration < 0.1:
                # Skip degenerate sub-100ms segments (Whisper occasionally
                # emits zero-length ones at file boundaries).
                continue

            slice_path = audio_io.slice_to_temp_wav(
                wav_path, seg.start, seg.end
            )
            temp_slices.append(slice_path)

            prosody_result = extract_prosody(str(slice_path))
            emotion_result = classify_emotion(str(slice_path))

            short = emotion_result.category
            long_name = SHORT_TO_LONG.get(short, short)

            emotion_payload = {
                "category": long_name,
                "category_short": short,
                "category_confidence": emotion_result.category_confidence,
                "valence": emotion_result.valence,
                "arousal": emotion_result.arousal,
                "dominance": emotion_result.dominance,
            }

            segments_out.append(
                {
                    "t": seg.start,
                    "duration": duration,
                    "text": seg.text,
                    "words": [w.to_dict() for w in seg.words],
                    "prosody": prosody_result.features.to_dict(),
                    "emotion": emotion_payload,
                    # Pre-computed visual spec via the shared research-grounded
                    # mapping engine. The web frontend recomputes this locally
                    # too, but emitting it here lets any other client (Chrome
                    # extension, mobile) render without re-implementing rules.
                    "visual": map_emotion_to_visual(emotion_payload),
                }
            )

        return {
            "metadata": {
                "duration": norm.duration,
                "sample_rate": norm.sample_rate,
                "language": transcription.language,
            },
            "segments": segments_out,
        }

    finally:
        for p in temp_slices:
            audio_io.safe_unlink(p)
        audio_io.cleanup_dir(work_dir)


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.timeline <audio_or_video_path>")
        sys.exit(1)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    out = build_timeline(sys.argv[1])
    print(json.dumps(out, indent=2, ensure_ascii=False))
