"""Fetch audio from a media URL (e.g. YouTube) via yt-dlp.

Used by the Chrome-extension flow: the content script reads the page's video
URL and sends it here; the backend downloads the audio so it can process the
whole file *ahead* of playback (the 1×-capture problem means a content script
can't supply future audio — see docs discussion). DRM-protected sites
(Netflix/Disney+) are not supported, by design.

Note: yt-dlp depends on the remote site's structure and is occasionally broken
by platform changes — for a guaranteed demo, pre-download the hero clip once.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

import yt_dlp

# Refuse very long videos so a stray link can't tie up the pipeline.
MAX_DURATION_SEC = 900  # 15 minutes


# YouTube now gates its streams behind a JavaScript challenge; without a JS
# runtime yt-dlp intermittently gets HTTP 403. yt-dlp only enables deno by
# default, so also allow node (already installed for the frontend). The
# solver scripts come from the yt-dlp-ejs package (yt-dlp[default]).
JS_RUNTIMES = {"deno": {}, "node": {}}

# YouTube intermittently answers the web client's stream with HTTP 403 (it is
# experimenting with binding a PO token to the video). The same request often
# succeeds on a second try, and the mobile-web client is not affected — so
# alternate between them before giving up. None = yt-dlp's default clients.
DOWNLOAD_CLIENTS = (None, ["mweb"], None, ["mweb"])


class TooLongError(RuntimeError):
    pass


def probe_duration(url: str) -> Optional[float]:
    """Return the media duration in seconds without downloading."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "js_runtimes": JS_RUNTIMES,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    dur = info.get("duration") if isinstance(info, dict) else None
    return float(dur) if dur is not None else None


def download_audio(
    url: str,
    out_dir: Optional[Path] = None,
    max_duration_sec: float = MAX_DURATION_SEC,
) -> Path:
    """Download best-audio for `url` into `out_dir`; return the file path.

    Downloads the raw best-audio stream (no re-encode) — our normalize step
    (FFmpeg → 16 kHz mono WAV) handles conversion downstream. Caller owns
    cleanup of `out_dir`.
    """
    out_dir = out_dir or Path(tempfile.mkdtemp(prefix="soundshape_dl_"))
    out_dir.mkdir(parents=True, exist_ok=True)

    dur = probe_duration(url)
    if dur is not None and dur > max_duration_sec:
        raise TooLongError(
            f"Video is {dur:.0f}s; limit is {max_duration_sec:.0f}s."
        )

    last_err: Optional[Exception] = None
    for client in DOWNLOAD_CLIENTS:
        opts = {
            "format": "bestaudio/best",
            "outtmpl": str(out_dir / "audio.%(ext)s"),
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "noplaylist": True,
            "js_runtimes": JS_RUNTIMES,
        }
        if client:
            opts["extractor_args"] = {"youtube": {"player_client": client}}
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except yt_dlp.utils.DownloadError as e:
            last_err = e
            for partial in out_dir.glob("audio.*"):
                partial.unlink(missing_ok=True)
            continue
        files = sorted(out_dir.glob("audio.*"))
        if files:
            return files[0]
    if last_err is not None:
        raise last_err
    raise RuntimeError("yt-dlp produced no output file")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python -m backend.pipeline.fetch <url>")
        sys.exit(1)
    p = download_audio(sys.argv[1])
    print("downloaded:", p, f"({p.stat().st_size/1024:.0f} KB)")
