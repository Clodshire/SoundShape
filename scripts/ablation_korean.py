"""Korean emotion-recognition ablation: what does each component contribute?

Four conditions on the SAME data, SAME folds, SAME seed — the only difference
is the feature set (plus, for D, a post-hoc text correction):

  A. prosody only          (14 PRAAT features)
  B. wav2vec2 only         (1024-d embedding)
  C. prosody + wav2vec2    (current system — should reproduce 43.6%)
  D. C + text-sentiment correction (the backend's fuse_valence rule, adapted
     to classifier space: text is consulted ONLY when the classifier is
     uncertain, so a confident acoustic read — sarcasm — is never overridden)

Reuses eval_korean.py's cached features (korean_features.npz) and its
build_subset() to recover each cached row's transcript (발화문 column of the
AIHub CSV) for condition D. No re-extraction needed.

Results are saved incrementally per condition (results/ablation_ko.json), so
an interrupted run resumes where it left off. Final table → ablation_ko.csv.

    python scripts/ablation_korean.py

Optionally pass a cached embedding slug to run the same four conditions on a
different backbone (e.g. after adopting the Korean XLSR embedding) — results
go to results/ablation_ko_<model>.{json,csv} without touching the originals:

    python scripts/ablation_korean.py kresnik__wav2vec2-large-xlsr-korean
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.decomposition import PCA
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from eval_korean import CSVP, N_PER_CLASS, SEED, build_subset  # noqa: E402

CACHE = REPO / "data" / "timelines" / "korean_features.npz"
RESULTS = REPO / "results"
RESULTS.mkdir(exist_ok=True)
PARTIAL = RESULTS / "ablation_ko.json"
TEXTVAL_CACHE = RESULTS / "ablation_ko_textval.json"
CSV_OUT = RESULTS / "ablation_ko.csv"

EMB_DIM = 1024  # X layout: [0:1024] wav2vec2, [1024:] 14 prosody features

# ── Condition-D gates: same constants as backend fuse_valence (emotion.py),
# translated to classifier space (softmax top-2 gap plays the role of |v|).
UNCERTAIN_BAND = 0.2   # only correct when top1−top2 softmax gap < this
TEXT_MIN_CONF = 0.5    # ignore low-confidence text sentiment
TEXT_MAX_PULL = 0.5    # cap on how hard text can push the scores

# Valence polarity per AIHub class: which classes positive/negative text
# evidence should push toward. surprise/neutral are valence-ambiguous → 0.
POLARITY = {"happiness": +1.0, "surprise": 0.0, "neutral": 0.0,
            "angry": -1.0, "disgust": -1.0, "fear": -1.0, "sadness": -1.0}


def make_clf() -> Pipeline:
    """The exact pipeline from eval_korean.py — identical across conditions."""
    return Pipeline([
        ("scale", StandardScaler()),
        ("pca", PCA(n_components=0.95, random_state=0)),
        ("svm", SVC(kernel="linear", C=1.0, class_weight="balanced",
                    random_state=0)),
    ])


def make_cv() -> StratifiedKFold:
    return StratifiedKFold(n_splits=5, shuffle=True, random_state=0)


def load_transcripts(y: np.ndarray) -> list[str]:
    """Recover the transcript for each cached feature row.

    build_subset() is deterministic (same CSV, same SEED), so re-running it
    yields the same (wav, label) order the cache was extracted in. Verified
    by checking all labels match the cached y exactly.
    """
    subset = build_subset()
    assert len(subset) == len(y), (
        f"subset {len(subset)} != cache {len(y)} — CSV or SEED changed since "
        "extraction; re-run eval_korean.py to rebuild the cache")
    labs = np.array([lab for _, lab in subset])
    assert (labs == y).all(), (
        "label order mismatch — subset no longer aligns with cached rows")

    by_id = {}
    with open(CSVP, encoding="cp949", errors="replace") as f:
        r = csv.reader(f)
        next(r)
        for row in r:
            if len(row) >= 2:
                by_id[row[0].strip()] = row[1].strip()
    return [by_id.get(wav.stem, "") for wav, _ in subset]


def text_valences(texts: list[str]) -> np.ndarray:
    """(valence, confidence) per transcript via the backend's Korean-routed
    sentiment model (WhitePeak). Cached — the model run is the slow part."""
    if TEXTVAL_CACHE.exists():
        arr = np.array(json.loads(TEXTVAL_CACHE.read_text()), dtype=np.float64)
        if len(arr) == len(texts):
            print(f"Loaded cached text valences ({len(arr)})")
            return arr
    from backend.pipeline.text_sentiment import text_valence
    out = []
    for i, t in enumerate(texts, 1):
        out.append(text_valence(t, "ko"))
        if i % 250 == 0:
            print(f"  text sentiment {i}/{len(texts)}")
    arr = np.array(out, dtype=np.float64)
    TEXTVAL_CACHE.write_text(json.dumps(arr.tolist()))
    return arr


def softmax(z: np.ndarray) -> np.ndarray:
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def correct_with_text(scores: np.ndarray, classes: np.ndarray,
                      tv: np.ndarray) -> tuple[np.ndarray, int]:
    """Apply the fuse_valence rule in classifier space.

    Gated exactly like the backend: skip when the classifier is confident
    (top-2 softmax gap ≥ band) or the text is unsure (conf < min). Otherwise
    nudge each class score by polarity-aligned text valence, pull fading to
    zero at the band edge.
    """
    p = softmax(scores)
    pol = np.array([POLARITY[c] for c in classes])
    pred = classes[p.argmax(axis=1)].copy()
    n_corrected = 0
    for i in range(len(p)):
        top2 = np.sort(p[i])[-2:]
        gap = top2[1] - top2[0]
        if gap >= UNCERTAIN_BAND:
            continue  # classifier is confident → trust the voice (sarcasm-safe)
        v, conf = tv[i]
        if conf < TEXT_MIN_CONF:
            continue
        uncertainty = 1.0 - gap / UNCERTAIN_BAND
        adj = p[i] + uncertainty * v * conf * TEXT_MAX_PULL * pol
        new = classes[adj.argmax()]
        if new != pred[i]:
            n_corrected += 1
            pred[i] = new
    return pred, n_corrected


def metrics(y, pred) -> dict:
    return {
        "accuracy": round(float(accuracy_score(y, pred)), 4),
        "macro_f1": round(float(f1_score(y, pred, average="macro")), 4),
        "per_class_f1": {
            c: round(float(f), 4)
            for c, f in zip(sorted(set(y.tolist())),
                            f1_score(y, pred, average=None,
                                     labels=sorted(set(y.tolist()))))
        },
    }


def save_partial(results: dict, path: Path) -> None:
    path.write_text(json.dumps(results, indent=2, ensure_ascii=False))


def main(emb_override: str | None = None) -> int:
    if not CACHE.exists():
        print(f"Missing {CACHE}. Run scripts/eval_korean.py first.")
        return 1
    d = np.load(CACHE, allow_pickle=True)
    X, y = d["X"], d["y"]
    tag = ""
    if emb_override:
        emb_path = REPO / "data" / "timelines" / f"korean_emb_{emb_override}.npz"
        E = np.load(emb_path)["E"]
        assert len(E) == len(y), f"{emb_path.name} rows != cached labels"
        X = np.hstack([E.astype(X.dtype), X[:, EMB_DIM:]])
        tag = "_" + emb_override.split("__")[0]
        print(f"Embedding override: {emb_override}")
    partial_path = RESULTS / f"ablation_ko{tag}.json"
    csv_path = RESULTS / f"ablation_ko{tag}.csv"
    print(f"Features {X.shape} — emb {EMB_DIM} + prosody {X.shape[1] - EMB_DIM}"
          f" | {N_PER_CLASS}/class, seed {SEED}")

    conditions = {
        "A_prosody_only": X[:, EMB_DIM:],
        "B_wav2vec2_only": X[:, :EMB_DIM],
        "C_combined": X,
    }

    results = json.loads(partial_path.read_text()) if partial_path.exists() else {}
    if results:
        print(f"Resuming — already done: {sorted(results)}")

    for name, Xc in conditions.items():
        if name in results:
            continue
        print(f"\n[{name}] {Xc.shape[1]}-d, 5-fold CV…")
        pred = cross_val_predict(make_clf(), Xc, y, cv=make_cv())
        results[name] = metrics(y, pred)
        save_partial(results, partial_path)
        print(f"  acc {results[name]['accuracy']:.1%}"
              f"  macro-F1 {results[name]['macro_f1']:.3f}  (saved)")

    if "D_combined_plus_text" not in results:
        print("\n[D_combined_plus_text] decision scores + text correction…")
        texts = load_transcripts(y)
        tv = text_valences(texts)
        scores = cross_val_predict(make_clf(), X, y, cv=make_cv(),
                                   method="decision_function")
        classes = np.array(sorted(set(y.tolist())))
        base_pred = classes[softmax(scores).argmax(axis=1)]
        agree = float((base_pred == y).mean())
        print(f"  score-argmax baseline acc {agree:.1%} "
              f"(vs C predict {results['C_combined']['accuracy']:.1%})")
        pred, n_corr = correct_with_text(scores, classes, tv)
        results["D_combined_plus_text"] = metrics(y, pred)
        results["D_combined_plus_text"]["n_text_corrected"] = n_corr
        results["D_combined_plus_text"]["score_argmax_baseline_acc"] = round(
            agree, 4)
        save_partial(results, partial_path)
        print(f"  acc {results['D_combined_plus_text']['accuracy']:.1%}"
              f"  macro-F1 {results['D_combined_plus_text']['macro_f1']:.3f}"
              f"  ({n_corr} predictions changed by text)  (saved)")

    # ── Final table ──
    rows = [
        ("A", "운율만 (14 PRAAT)", "A_prosody_only"),
        ("B", "wav2vec2만 (1024d)", "B_wav2vec2_only"),
        ("C", "운율+임베딩 (현재)", "C_combined"),
        ("D", "C + 텍스트 보정", "D_combined_plus_text"),
    ]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["condition", "features", "accuracy", "macro_f1"])
        for cid, desc, key in rows:
            r = results[key]
            w.writerow([cid, desc, r["accuracy"], r["macro_f1"]])

    print("\n" + "=" * 62)
    print(f"KOREAN ABLATION (7-class, N={len(y)}, stratified 5-fold, seed 0)")
    print("=" * 62)
    print(f"{'':2} {'구성':24} {'정확도':>8} {'macro-F1':>9}")
    print("-" * 62)
    for cid, desc, key in rows:
        r = results[key]
        print(f"{cid:2} {desc:24} {r['accuracy']:>7.1%} {r['macro_f1']:>9.3f}")
    print("-" * 62)
    ca = results["C_combined"]["accuracy"]
    rd = results["D_combined_plus_text"]
    # D's fair baseline is the score-argmax on the SAME decision scores — NOT
    # C's predict. SVC.predict (ovo votes) and ovr decision-function argmax
    # disagree on some samples, and attributing that prediction-rule gap to
    # the text correction would overstate the text contribution.
    print(f"기여도: 운율 Δ{ca - results['B_wav2vec2_only']['accuracy']:+.1%}"
          f" | 임베딩 Δ{ca - results['A_prosody_only']['accuracy']:+.1%}"
          f" | 텍스트 Δ{rd['accuracy'] - rd['score_argmax_baseline_acc']:+.1%}"
          f" (D 대비 동일-규칙 베이스라인"
          f" {rd['score_argmax_baseline_acc']:.1%})")
    print(f"\nSaved → {csv_path.relative_to(REPO)} + {partial_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
