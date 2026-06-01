"""Progressive (streaming) timeline builder.

Yields the timeline incrementally — metadata first, then each segment as soon
as it's computed — so the frontend can start playback after a short prebuffer
(the "head") while the rest is processed ahead of playback. Because the backend
holds the whole file, processing runs faster than real time (with the `small`
model, RTF ≈ 0.17 on a 30s window), so the ready-horizon stays ahead of the
playhead → zero perceived delay after the initial prebuffer.

Default model is `small` (≈3s per 30s window → ~5-6s prebuffer). Offline
`build_timeline` keeps `large-v3-turbo` for maximum accuracy.

Event stream (one JSON object per yield):
    {"type": "metadata", "duration": float, "sample_rate": int, "language": str}
    {"type": "segment",  "t": float, "duration": float, "text": str,
                         "words": [...], "prosody": {...}, "emotion": {...},
                         "visual": {...}}
    {"type": "done", "segments": int}
    {"type": "error", "message": str}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator, Optional

from backend.mapping.engine import map_emotion_to_visual
from backend.pipeline import asr, audio_io
from backend.pipeline.chunker import find_chunk_boundaries
from backend.pipeline.emotion import classify_emotion
from backend.pipeline.prosody import extract_prosody

logger = logging.getLogger(__name__)

STREAM_MODEL = "small"


def stream_timeline(
    input_path: str | Path,
    language: Optional[str] = None,
    model_size: str = STREAM_MODEL,
) -> Iterator[dict]:
    """Yield metadata, then segments as they're computed, then a done event."""
    input_path = Path(input_path)
    norm = audio_io.normalize_to_wav(input_path)
    wav_path = norm.path
    work_dir = wav_path.parent

    emitted = 0
    detected_lang = language
    try:
        boundaries = find_chunk_boundaries(wav_path)
        logger.info(
            "streaming %s: %.1fs → %d chunk(s)",
            input_path.name,
            norm.duration,
            len(boundaries),
        )
        # Metadata first. Language may be unknown until the first chunk; if the
        # caller didn't pin it we fill it in after chunk 1 via a second event.
        yield {
            "type": "metadata",
            "duration": norm.duration,
            "sample_rate": norm.sample_rate,
            "language": detected_lang or "",
        }

        for ci, (cs, ce) in enumerate(boundaries):
            chunk_path = audio_io.slice_to_temp_wav(wav_path, cs, ce)
            try:
                tr = asr.transcribe(
                    str(chunk_path), language=detected_lang, model_size=model_size
                )
            finally:
                audio_io.safe_unlink(chunk_path)

            # Lock language from the first chunk so later chunks stay consistent.
            if detected_lang is None and tr.language:
                detected_lang = tr.language
                yield {"type": "language", "language": detected_lang}

            for seg in tr.segments:
                seg_dur = seg.end - seg.start
                if seg_dur < 0.1:
                    continue
                abs_start = cs + seg.start
                abs_end = cs + seg.end

                seg_path = audio_io.slice_to_temp_wav(wav_path, abs_start, abs_end)
                try:
                    prosody = extract_prosody(str(seg_path)).features.to_dict()
                    emo = classify_emotion(str(seg_path))
                finally:
                    audio_io.safe_unlink(seg_path)

                emotion_payload = {
                    "category": emo.category,  # derived long name
                    "category_short": emo.model_label,
                    "category_confidence": emo.category_confidence,
                    "valence": emo.valence,
                    "arousal": emo.arousal,
                    "dominance": emo.dominance,
                }
                # Offset word timestamps to absolute time too.
                words = [
                    {
                        "word": w.word,
                        "start": cs + w.start,
                        "end": cs + w.end,
                        "probability": w.probability,
                    }
                    for w in seg.words
                ]
                yield {
                    "type": "segment",
                    "t": abs_start,
                    "duration": seg_dur,
                    "text": seg.text,
                    "words": words,
                    "prosody": prosody,
                    "emotion": emotion_payload,
                    "visual": map_emotion_to_visual(emotion_payload, prosody),
                }
                emitted += 1

        yield {"type": "done", "segments": emitted}

    except Exception as e:  # noqa: BLE001
        logger.exception("stream_timeline failed")
        yield {"type": "error", "message": str(e)}
    finally:
        audio_io.cleanup_dir(work_dir)
