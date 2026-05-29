"""FastAPI app — uploads in, JSON timeline out.

Run locally:
    uvicorn backend.api.main:app --reload --port 8000

Endpoints:
    GET  /health        — liveness check
    POST /process       — multipart upload, returns timeline JSON
"""

from __future__ import annotations

import logging
import tempfile
import traceback
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.pipeline.timeline import build_timeline

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("soundshape.api")

app = FastAPI(
    title="SoundShape API",
    version="0.4.0",
    description="Audio in, emotion-visualization timeline JSON out.",
)

# CORS — Next.js dev server runs on :3000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


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
