# SoundShape — Chrome extension

Overlays the SoundShape emotion field on a YouTube video, live and synced.

## How it works

```
YouTube page ──URL──▶ content.js ──POST /process/stream/url──▶ local backend (yt-dlp + pipeline)
     ▲                    │                                          │
     └── emotion overlay ─┘ ◀──────────── NDJSON segments (streamed) ┘
        (synced to video.currentTime)
```

The content script reads the page URL, sends it to the local backend, which
downloads the audio (yt-dlp) and streams back the emotion timeline. The overlay
uses the **same WebGL renderer as the web app** (`frontend/src/lib/emotionField.ts`),
starts after a short prebuffer, and stays in sync via the player's own clock
(`video.currentTime`) with buffer-health gating.

## Run it

1. **Start the backend** (from the repo root):
   ```bash
   source venv/bin/activate
   uvicorn backend.api.main:app --port 8000
   ```
2. **Load the extension**: open `chrome://extensions` → enable **Developer mode**
   → **Load unpacked** → select this `extension/` folder.
3. Open any YouTube **watch** page, then click the floating **✦ SoundShape**
   button on the player. After a ~6 s "analyzing the opening…" prebuffer,
   playback starts with the emotion field + captions overlaid. Click again to stop.

## Rebuild after changing source

`content.js` is a bundle of `src/content.ts` (+ the shared renderer):
```bash
node extension/build.mjs
```

## Limitations

- **YouTube only.** Netflix/Disney+ are DRM-protected — their audio can't be
  read, by design.
- **yt-dlp** can break when YouTube changes; for a guaranteed demo, pre-download
  the hero clip's audio and use the web app's file-upload path as a fallback.
- Backend must be running locally on `:8000`.
