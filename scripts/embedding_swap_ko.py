"""Embedding-swap experiment: does a Korean-stronger backbone beat the current
English-emotion-tuned wav2vec2 on Korean 7-class emotion?

Identical protocol to ablation_korean.py condition C — same clips, same
StratifiedKFold(5, shuffle, seed 0), same Scaler→PCA→SVM, same 14 prosody
features. The ONLY change per row is which model produced the 1024-d embedding:

  baseline  audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim (current)
  swap 1    kresnik/wav2vec2-large-xlsr-korean       (Korean ASR-tuned XLSR)
  swap 2    facebook/wav2vec2-xls-r-300m             (128-lang pretrain)
  swap 3    byc3230/hubert-large-korean-finetuned-korspeech-ser
            (Korean-pretrained HuBERT + Korean SER tune — possible overlap
             with our AIHub eval data; treat its number as an upper bound)

Per-model embeddings are cached (data/timelines/korean_emb_<slug>.npz) with
partial checkpoints every 250 clips, and per-model results are saved as they
finish (results/embedding_swap_ko.json + .csv) — an interrupted overnight run
resumes where it left off.

    python scripts/embedding_swap_ko.py [model_id ...]
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from sklearn.model_selection import cross_val_predict  # noqa: E402

from ablation_korean import EMB_DIM, make_clf, make_cv, metrics  # noqa: E402
from eval_korean import build_subset  # noqa: E402
from backend.pipeline.emotion import _load_wave_16k  # noqa: E402

CACHE = REPO / "data" / "timelines" / "korean_features.npz"
EMB_DIR = REPO / "data" / "timelines"
RESULTS = REPO / "results"
RESULTS.mkdir(exist_ok=True)
PARTIAL = RESULTS / "embedding_swap_ko.json"
CSV_OUT = RESULTS / "embedding_swap_ko.csv"

BASELINE_ID = "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim"
DEFAULT_MODELS = [
    "kresnik/wav2vec2-large-xlsr-korean",
    "facebook/wav2vec2-xls-r-300m",
    "byc3230/hubert-large-korean-finetuned-korspeech-ser",
]
CHECKPOINT_EVERY = 250


def slug(model_id: str) -> str:
    return model_id.replace("/", "__")


def load_backbone(model_id: str):
    """Backbone + feature extractor, generically. AutoModel strips any task
    head (CTC / classification), leaving the wav2vec2/HuBERT encoder."""
    from transformers import AutoFeatureExtractor, AutoModel
    fe = AutoFeatureExtractor.from_pretrained(model_id)
    model = AutoModel.from_pretrained(model_id)
    model.eval()
    return fe, model


def extract_embeddings(model_id: str, wavs: list[Path]) -> np.ndarray:
    """Mean-pooled last-hidden-state per clip, with resumable checkpoints."""
    final = EMB_DIR / f"korean_emb_{slug(model_id)}.npz"
    part = EMB_DIR / f"korean_emb_{slug(model_id)}.partial.npz"
    if final.exists():
        E = np.load(final)["E"]
        if len(E) == len(wavs):
            print(f"  cached embeddings {E.shape}")
            return E
    done, chunks = 0, []
    if part.exists():
        d = np.load(part)
        chunks, done = [d["E"]], int(d["E"].shape[0])
        print(f"  resuming from checkpoint: {done}/{len(wavs)}")

    fe, model = load_backbone(model_id)
    buf = []
    t0 = time.time()
    with torch.no_grad():
        for i, wav in enumerate(wavs[done:], done + 1):
            sig = _load_wave_16k(str(wav))
            inp = fe(sig, sampling_rate=16000, return_tensors="pt",
                     padding=True)
            h = model(inp["input_values"]).last_hidden_state
            buf.append(h.mean(dim=1).squeeze(0).numpy().astype(np.float32))
            if i % CHECKPOINT_EVERY == 0 or i == len(wavs):
                chunks.append(np.vstack(buf))
                buf = []
                np.savez(part, E=np.vstack(chunks))
                rate = (i - done) / max(time.time() - t0, 1e-9)
                eta = (len(wavs) - i) / max(rate, 1e-9) / 60
                print(f"  {i}/{len(wavs)}  ({rate:.1f} clips/s, ~{eta:.0f} min left)")
    E = np.vstack(chunks)
    np.savez(final, E=E, model_id=model_id)
    part.unlink(missing_ok=True)
    del model
    return E


def write_csv(results: dict) -> None:
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["model", "emb_dim", "accuracy", "macro_f1", "note"])
        for mid, r in results.items():
            w.writerow([mid, r.get("emb_dim", ""), r["accuracy"],
                        r["macro_f1"], r.get("note", "")])


def main() -> int:
    models = sys.argv[1:] or DEFAULT_MODELS
    if not CACHE.exists():
        print(f"Missing {CACHE}. Run scripts/eval_korean.py first.")
        return 1
    d = np.load(CACHE, allow_pickle=True)
    X, y = d["X"], d["y"]
    prosody = X[:, EMB_DIM:]  # same 14 features for every row of the table

    # Recover the clip list in cached order (verified against cached labels).
    subset = build_subset()
    assert len(subset) == len(y) and \
        (np.array([lab for _, lab in subset]) == y).all(), \
        "subset no longer aligns with cached rows — rebuild the cache"
    wavs = [w for w, _ in subset]

    results = json.loads(PARTIAL.read_text()) if PARTIAL.exists() else {}

    # Baseline row = current system (embeddings already in the cache).
    if BASELINE_ID not in results:
        print(f"[baseline] {BASELINE_ID}")
        pred = cross_val_predict(make_clf(), X, y, cv=make_cv())
        results[BASELINE_ID] = {**metrics(y, pred), "emb_dim": EMB_DIM,
                                "note": "current system (cached features)"}
        PARTIAL.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        write_csv(results)
        print(f"  acc {results[BASELINE_ID]['accuracy']:.1%}")

    for mid in models:
        if mid in results:
            print(f"[skip] {mid} — already done")
            continue
        print(f"\n[{mid}]")
        try:
            E = extract_embeddings(mid, wavs)
            Xm = np.hstack([E, prosody])
            print(f"  evaluating {Xm.shape[1]}-d (same folds/seed as ablation)…")
            pred = cross_val_predict(make_clf(), Xm, y, cv=make_cv())
            r = {**metrics(y, pred), "emb_dim": int(E.shape[1])}
            if "byc3230" in mid:
                r["note"] = ("possible train/eval overlap with AIHub — "
                             "interpret as upper bound")
        except Exception as e:  # noqa: BLE001 — keep the overnight run alive
            print(f"  FAILED: {e}")
            r = {"accuracy": None, "macro_f1": None, "note": f"failed: {e}"}
        results[mid] = r
        PARTIAL.write_text(json.dumps(results, indent=2, ensure_ascii=False))
        write_csv(results)
        if r["accuracy"] is not None:
            print(f"  acc {r['accuracy']:.1%}  macro-F1 {r['macro_f1']:.3f}  (saved)")

    print("\n" + "=" * 70)
    print(f"EMBEDDING SWAP (Korean 7-class, N={len(y)}, same protocol as ablation)")
    print("=" * 70)
    base_acc = results[BASELINE_ID]["accuracy"]
    for mid, r in results.items():
        if r["accuracy"] is None:
            print(f"  {mid:55s} FAILED")
            continue
        delta = "" if mid == BASELINE_ID else f"  Δ{r['accuracy'] - base_acc:+.1%}"
        print(f"  {mid:55s} {r['accuracy']:.1%}{delta}")
    print(f"\nSaved → {CSV_OUT.relative_to(REPO)} + embedding_swap_ko.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
