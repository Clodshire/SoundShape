"""Does separation actually protect the emotion analysis?

The claim behind improvement #3 is that background music destabilises prosody
and that separating it out restores accuracy. That is measurable, so it should
be measured rather than asserted.

RAVDESS gives clean studio speech with known emotion labels. Mixing music into
it at a controlled level produces the contaminated case WITHOUT losing the
ground truth, so three conditions can be compared on identical clips:

    clean        the original recording      — the ceiling
    mixed        music added, no separation  — what the product does today
    separated    music added, then separated — what improvement #3 proposes

Classification is speaker-independent (GroupKFold by actor), the same protocol
as every other accuracy number in this project, so the results are comparable.

    python scripts/eval_separation.py

⚠️ The music here is SYNTHETIC — layered chords, bass and percussion generated
below, not commercial recordings. That is a real limitation: synthetic cues are
more separable than a dense orchestral mix, so these numbers are an upper bound
on what separation buys. It is stated in the output and must be stated in any
write-up.
"""

from __future__ import annotations

import csv
import sys
import time
from math import comb
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# SNRs to test, overridable from the command line so an extra point can be
# measured without invalidating the cache of the ones already run:
#     python scripts/eval_separation.py 5
SNRS_DB = [float(a) for a in sys.argv[1:]] or [10.0, 0.0]
_TAG = "" if SNRS_DB == [10.0, 0.0] else "_" + "_".join(f"{s:+.0f}" for s in SNRS_DB)
CACHE = REPO / "data" / "timelines" / f"separation_eval_cache{_TAG}.npz"
OUT = REPO / "results" / f"separation_comparison{_TAG}.csv"

PROSODY_KEYS = [
    "f0_mean", "f0_std", "f0_min", "f0_max", "f0_range",
    "intensity_mean", "intensity_std", "intensity_min", "intensity_max",
    "jitter_local", "shimmer_local", "hnr_mean", "voiced_ratio",
    "speech_rate_approx",
]


# ── synthetic score bank ─────────────────────────────────────────────


def make_cue(kind: int, seconds: float, sr: int, seed: int) -> np.ndarray:
    """One passage of music: chords with overtones, a bass line, percussion.

    Varied across clips so the classifier cannot learn "the music" as a
    constant and quietly ignore it — that would flatter the mixed condition.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    root = [220.0, 246.9, 261.6, 293.7][kind % 4]
    third = root * (1.19 if kind % 2 else 1.26)      # minor / major
    chord = [root, third, root * 1.5, root * 2]

    y = np.zeros(n, dtype=np.float64)
    for i, f in enumerate(chord):
        # A few overtones and slight detuning make this harder to separate than
        # a bare sine, which is the point.
        for h, amp in ((1, 1.0), (2, 0.35), (3, 0.15)):
            y += amp / (i + 1) * np.sin(
                2 * np.pi * f * h * t + rng.uniform(0, 2 * np.pi)
            )
    y += 0.6 * np.sin(2 * np.pi * (root / 2) * t)     # bass

    # Phrase envelope, so the cue breathes instead of sitting flat.
    bpm = [72.0, 96.0, 120.0, 144.0][kind % 4]
    y *= 0.6 + 0.4 * np.sin(2 * np.pi * (bpm / 60.0) / 4.0 * t) ** 2

    beat = (np.sin(2 * np.pi * (bpm / 60.0) * t) > 0.92).astype(float)
    y += 0.5 * beat * rng.normal(size=n)              # percussion
    return (y / (np.max(np.abs(y)) + 1e-9)).astype(np.float32)


def mix_at_snr(speech: np.ndarray, music: np.ndarray, snr_db: float) -> np.ndarray:
    """Scale the music so speech sits `snr_db` above it, then add."""
    if len(music) < len(speech):
        music = np.tile(music, int(np.ceil(len(speech) / len(music))))
    music = music[: len(speech)]
    s_rms = np.sqrt(np.mean(speech.astype(np.float64) ** 2)) + 1e-9
    m_rms = np.sqrt(np.mean(music.astype(np.float64) ** 2)) + 1e-9
    scale = (s_rms / m_rms) / (10 ** (snr_db / 20.0))
    mixed = speech + music * scale
    peak = np.max(np.abs(mixed))
    return (mixed / peak * 0.95).astype(np.float32) if peak > 0.95 else mixed.astype(np.float32)


# ── feature extraction ───────────────────────────────────────────────


def features_for(paths, processor, model, label: str) -> np.ndarray:
    import torch

    from backend.pipeline.emotion import _load_wave_16k
    from backend.pipeline.prosody import extract_prosody

    out = []
    t0 = time.time()
    for i, p in enumerate(paths, 1):
        signal = _load_wave_16k(str(p))
        inputs = processor(
            signal, sampling_rate=16000, return_tensors="pt", padding=True
        )
        with torch.no_grad():
            hidden = model.wav2vec2(inputs["input_values"]).last_hidden_state
            emb = hidden.mean(dim=1).squeeze(0).numpy().astype(np.float32)
        pros = extract_prosody(str(p)).features.to_dict()
        out.append(
            np.concatenate(
                [emb, np.array([pros[k] for k in PROSODY_KEYS], dtype=np.float32)]
            )
        )
        if i % 80 == 0:
            print(f"    {label}: {i}/{len(paths)}  ({time.time()-t0:.0f}s)")
    return np.vstack(out)


def score(X, y, groups) -> tuple[float, float, np.ndarray]:
    from sklearn.metrics import accuracy_score, f1_score
    from sklearn.model_selection import GroupKFold

    sys.path.insert(0, str(REPO / "scripts"))
    from build_runtime_classifiers import make_pipeline

    pred = np.empty_like(y)
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        clf = make_pipeline(probability=False)
        clf.fit(X[tr], y[tr])
        pred[te] = clf.predict(X[te])
    return (
        accuracy_score(y, pred),
        f1_score(y, pred, average="macro"),
        pred,
    )


def mcnemar_exact(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / (2**n))


def main() -> int:
    import json

    import soundfile as sf

    from backend.pipeline import separation
    from backend.pipeline.audio_io import SAMPLE_RATE
    from backend.pipeline.emotion import _dimensional_model

    base = np.load(REPO / "data/timelines/ravdess_features.npz", allow_pickle=True)
    y, groups = base["y"], base["groups"]
    clean_X = base["X"]

    clips = sorted((REPO / "data/datasets/RAVDESS").glob("Actor_*/*.wav"))
    if len(clips) != len(y):
        print(f"clip count {len(clips)} != cached labels {len(y)}")
        return 1

    if CACHE.exists():
        d = np.load(CACHE, allow_pickle=True)
        print(f"캐시 사용 → {CACHE.name}")
        feats = {k: d[k] for k in d.files}
    else:
        # Separation has to be on for this script regardless of the shipped
        # default — written to a scratch config so the repo's setting is never
        # touched by an experiment.
        scratch = REPO / "data" / "timelines" / "_sep_eval_config.json"
        cfg = json.loads(separation.CONFIG_PATH.read_text(encoding="utf-8"))
        cfg["enabled"] = True
        cfg["music_probe_seconds"] = 0.0     # clips are short; separate all of it
        cfg["music_energy_ratio_min"] = 0.0  # never skip — we know music is there
        scratch.write_text(json.dumps(cfg), encoding="utf-8")
        separation.CONFIG_PATH = scratch

        processor, model = _dimensional_model()
        work = REPO / "data" / "timelines" / "_sep_eval_tmp"
        work.mkdir(parents=True, exist_ok=True)
        feats = {}

        for snr in SNRS_DB:
            print(f"\nSNR {snr:+.0f} dB — 혼합 및 분리 중 ({len(clips)}개)…")
            mixed_paths, sep_paths = [], []
            t0 = time.time()
            for i, clip in enumerate(clips):
                speech, sr = sf.read(str(clip), dtype="float32", always_2d=False)
                if speech.ndim > 1:
                    speech = speech.mean(axis=1)
                cue = make_cue(i % 4, len(speech) / sr + 1.0, sr, seed=i)
                mixed = mix_at_snr(speech, cue, snr)

                mp = work / f"mix_{snr:+.0f}_{i:04d}.wav"
                sf.write(mp, mixed, sr)
                mixed_paths.append(mp)

                # Separation wants 44.1 kHz stereo.
                st = np.stack([mixed, mixed], axis=0)
                import torchaudio, torch

                tens = torchaudio.functional.resample(
                    torch.from_numpy(st), sr, 44_100
                ).numpy()
                vocals, _music = separation.separate_array(tens, 44_100)
                voc16 = torchaudio.functional.resample(
                    torch.from_numpy(vocals), 44_100, SAMPLE_RATE
                ).numpy()
                sp = work / f"sep_{snr:+.0f}_{i:04d}.wav"
                sf.write(sp, voc16, SAMPLE_RATE)
                sep_paths.append(sp)
                if (i + 1) % 80 == 0:
                    print(f"    분리 {i+1}/{len(clips)}  ({time.time()-t0:.0f}s)")

            feats[f"mixed_{snr:+.0f}"] = features_for(
                mixed_paths, processor, model, f"mixed{snr:+.0f}"
            )
            feats[f"sep_{snr:+.0f}"] = features_for(
                sep_paths, processor, model, f"sep{snr:+.0f}"
            )
            for p in mixed_paths + sep_paths:
                p.unlink(missing_ok=True)

        np.savez(CACHE, **feats)
        print(f"캐시 저장 → {CACHE.name}")

    # ── scoring ──────────────────────────────────────────────────────
    print("\n음악 혼합이 감정 인식에 미치는 영향 (화자 독립 5-fold)\n")
    acc_c, f1_c, pred_c = score(clean_X, y, groups)
    print(f"{'조건':28}{'정확도':>9}{'macro-F1':>10}")
    print(f"{'깨끗한 원본 (상한)':28}{acc_c:9.1%}{f1_c:10.3f}")

    rows = [{"condition": "clean", "snr_db": "", "accuracy": round(acc_c, 4),
             "macro_f1": round(f1_c, 4)}]

    for snr in SNRS_DB:
        acc_m, f1_m, pred_m = score(feats[f"mixed_{snr:+.0f}"], y, groups)
        acc_s, f1_s, pred_s = score(feats[f"sep_{snr:+.0f}"], y, groups)
        print(f"\n  SNR {snr:+.0f} dB")
        print(f"{'  음악 섞음 · 분리 없음':28}{acc_m:9.1%}{f1_m:10.3f}")
        print(f"{'  음악 섞음 · 분리 함':28}{acc_s:9.1%}{f1_s:10.3f}"
              f"   ({acc_s - acc_m:+.1%}p)")
        b = int(np.sum((pred_s == y) & (pred_m != y)))
        c = int(np.sum((pred_m == y) & (pred_s != y)))
        print(f"    분리만 맞힘 {b} · 분리 없이만 맞힘 {c} "
              f"→ McNemar p = {mcnemar_exact(b, c):.4g}")
        recovered = (
            (acc_s - acc_m) / (acc_c - acc_m) if acc_c > acc_m else float("nan")
        )
        print(f"    음악으로 잃은 정확도의 {recovered:.0%}를 회복")
        rows += [
            {"condition": "mixed", "snr_db": snr, "accuracy": round(acc_m, 4),
             "macro_f1": round(f1_m, 4)},
            {"condition": "separated", "snr_db": snr, "accuracy": round(acc_s, 4),
             "macro_f1": round(f1_s, 4)},
        ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"\n저장 → {OUT.relative_to(REPO)}")
    print("\n⚠️ 음악은 합성음입니다. 실제 오케스트라보다 분리가 쉬우므로 "
          "이 수치는 상한으로 해석해야 합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
