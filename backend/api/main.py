"""FastAPI app — uploads in, JSON timeline out.

Run locally:
    uvicorn backend.api.main:app --reload --port 8000

Endpoints:
    GET  /health         — liveness check
    POST /process        — multipart upload, returns full timeline JSON (accurate)
    POST /process/stream — multipart upload, NDJSON stream of segments as ready
                           (progressive: head first → start playback early)
    POST /process/stream/url — same, but ingests a media URL (yt-dlp) — used by
                           the Chrome extension (YouTube). No DRM sites.
"""

from __future__ import annotations

import json
import logging
import tempfile
import traceback
from pathlib import Path
from typing import Iterator, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.pipeline.streaming import STREAM_MODEL, stream_timeline
from backend.pipeline.timeline import build_timeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("soundshape.api")

app = FastAPI(
    title="SoundShape API",
    version="0.4.0",
    description="Audio in, emotion-visualization timeline JSON out.",
)

# CORS — Next.js dev server (:3000) + the Chrome extension running on YouTube.
# (http://localhost is treated as a secure origin, so the https YouTube page is
# allowed to call it without mixed-content blocking.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://www.youtube.com",
        "https://youtube.com",
        "https://m.youtube.com",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def prewarm() -> None:
    """Warm the streaming model + emotion/prosody on startup so the first real
    request doesn't pay the cold model-load cost (cuts first-prebuffer latency).
    """
    sample = Path(__file__).resolve().parents[2] / "data" / "samples" / "test.wav"
    if not sample.exists():
        return
    try:
        from backend.pipeline import asr, emotion, prosody
        from backend.pipeline.text_sentiment import text_valence

        logger.info("Pre-warming models (%s)…", STREAM_MODEL)
        asr.transcribe(str(sample), model_size=STREAM_MODEL)
        emotion.classify_emotion(str(sample), text="warmup", language="en")
        prosody.extract_prosody(str(sample))
        text_valence("warmup", "en")
        text_valence("워밍업", "ko")
        logger.info("Pre-warm complete.")
    except Exception as e:  # noqa: BLE001
        logger.warning("Pre-warm skipped: %s", e)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": app.version}


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    model_size: str = Form(default="large-v3-turbo"),
) -> JSONResponse:
    """Run the full SoundShape pipeline on an uploaded audio/video file.

    Form fields:
        file:        the upload (any FFmpeg-readable media format).
        language:    optional ISO-639-1 hint for Whisper. None = auto-detect.
        model_size:  Whisper model size. 'base' (fast) or 'large-v3-turbo' (accurate).
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")

    # Persist the upload to a temp file FFmpeg can read.
    suffix = Path(file.filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(
        prefix="soundshape_upload_", suffix=suffix, delete=False
    ) as tmp:
        contents = await file.read()
        tmp.write(contents)
        upload_path = Path(tmp.name)

    logger.info(
        "Received %s (%d bytes) → %s", file.filename, len(contents), upload_path
    )

    try:
        timeline = build_timeline(
            upload_path, language=language, model_size=model_size
        )
    except Exception as e:
        logger.error("build_timeline failed: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"pipeline error: {e}") from e
    finally:
        try:
            upload_path.unlink(missing_ok=True)
        except OSError:
            pass

    logger.info(
        "Returning timeline · %d segments · lang=%s",
        len(timeline["segments"]),
        timeline["metadata"]["language"],
    )
    return JSONResponse(timeline)


@app.post("/process/stream")
def process_stream(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    model_size: str = Form(default=STREAM_MODEL),
) -> StreamingResponse:
    """Progressive processing — NDJSON stream, one event per line.

    Emits a metadata event, then a segment event as each utterance is computed
    (head first), then a done event. Lets the client start playback after a
    short prebuffer while the rest is processed ahead. Sync route → Starlette
    iterates the (CPU-heavy, sync) generator in a threadpool.

    Default model is `small` for a low prebuffer; pass model_size to override.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")

    suffix = Path(file.filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(
        prefix="soundshape_stream_", suffix=suffix, delete=False
    ) as tmp:
        tmp.write(file.file.read())
        upload_path = Path(tmp.name)

    logger.info("Stream request: %s → %s (model=%s)", file.filename, upload_path, model_size)

    def ndjson() -> Iterator[str]:
        try:
            for event in stream_timeline(
                upload_path, language=language, model_size=model_size
            ):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        finally:
            try:
                upload_path.unlink(missing_ok=True)
            except OSError:
                pass

    return StreamingResponse(
        ndjson(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/process/stream/url")
def process_stream_url(
    url: str = Form(...),
    language: Optional[str] = Form(default=None),
    model_size: str = Form(default=STREAM_MODEL),
) -> StreamingResponse:
    """Ingest a media URL (yt-dlp), then progressively stream the timeline.

    The Chrome extension reads the YouTube page's URL and POSTs it here.
    Emits a 'status: downloading' event first (the download blocks for a
    moment), then the same metadata/segment/done stream as /process/stream.
    """
    logger.info("Stream-URL request: %s (model=%s)", url, model_size)

    def ndjson() -> Iterator[str]:
        from backend.pipeline import audio_io, fetch

        dl_dir = None
        try:
            yield json.dumps({"type": "status", "stage": "downloading"}) + "\n"
            try:
                audio_path = fetch.download_audio(url)
            except fetch.TooLongError as e:
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"
                return
            except Exception as e:  # noqa: BLE001
                yield json.dumps(
                    {"type": "error", "message": f"download failed: {e}"}
                ) + "\n"
                return
            dl_dir = audio_path.parent
            for event in stream_timeline(
                audio_path, language=language, model_size=model_size
            ):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        finally:
            if dl_dir is not None:
                audio_io.cleanup_dir(dl_dir)

    return StreamingResponse(
        ndjson(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
