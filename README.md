# SoundShape

> *Captions tell you **what** was said. SoundShape shows you **how**.*

Emotion-visualization captioning system for deaf and hard-of-hearing users. Extracts prosodic features (pitch, intensity, jitter, shimmer, speech rate) from speech in real time and translates them into a synchronized **visual language** — shape, color, size, motion — overlaid on video and music.

Built for **Korea Code Fair (KCF) SW Competition** with an ISEF research narrative.

---

## Why it matters

The same word "괜찮아" can mean four different things depending on tone:
sincere reassurance, sarcasm, suppressed sadness, contained anger. Standard
captions collapse these into one line of text. Deaf viewers read the **lines**
but miss the **acting**. SoundShape fills that gap.

## Differentiators (vs. existing solutions)

1. **Prosody-grounded** — analyzes the speech signal itself, not text sentiment
2. **Continuous emotion space** — Russell's valence × arousal, not 6 discrete buckets
3. **Multi-channel visual encoding** — shape + color + size + motion (not one emoji)
4. **Research-grounded mapping** — Hupka 1997, Kiki/Bouba, Spence 2011, Russell 1980
5. **Accessibility-first design** — deaf users as the primary audience, not an afterthought

See [`docs/01_DIFFERENTIATION.md`](docs/01_DIFFERENTIATION.md) for the full comparison.

---

## Architecture (one-line summary)

```
audio → FFmpeg → VAD → [Whisper | Parselmouth | wav2vec2] → emotion vector → mapping engine → Canvas overlay
```

Full diagrams in [`docs/03_ARCHITECTURE.md`](docs/03_ARCHITECTURE.md).

## Stack

- **Backend:** Python 3.11 — Parselmouth (PRAAT), OpenAI Whisper, wav2vec2 (HuggingFace), FastAPI
- **Frontend:** Next.js 15 + TypeScript + TailwindCSS + Canvas + D3 + Framer Motion
- **Media:** FFmpeg

Full breakdown in [`docs/02_TECHSTACK.md`](docs/02_TECHSTACK.md).

---

## Project status

In active development. Roadmap in [`docs/04_ROADMAP.md`](docs/04_ROADMAP.md).

## Repo layout

```
SoundShape/
├── backend/           # Python: ML pipeline + FastAPI
│   ├── api/
│   ├── pipeline/      # vad, asr, prosody, emotion, timeline
│   ├── mapping/       # shape/color/size/motion rules (research-grounded)
│   ├── models/        # cached model weights (gitignored)
│   └── tests/
├── frontend/          # Next.js app
├── data/
│   ├── samples/       # test audio clips
│   ├── datasets/      # RAVDESS, IEMOCAP, etc. (gitignored)
│   └── timelines/     # processed JSON output (gitignored)
├── docs/              # design documents
└── notebooks/         # experiments & sanity checks
```

## Setup

See [`docs/04_ROADMAP.md`](docs/04_ROADMAP.md) §"Phase 0: Prerequisites".

---

## License

TBD.
