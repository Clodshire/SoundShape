"""Full-AI vs hybrid rendering, measured on RAVDESS.

The claim hybrid rendering makes is that the channels driven by measurement
report the voice truthfully even when the classifier is wrong. That is a claim
about the OUTPUT of the mapping, so it has to be measured on the output, not
argued from the architecture.

RAVDESS makes this testable without human raters: every clip is recorded at a
normal and a strong emotional intensity, and which one it is sits in field 4 of
the filename. So there is a ground truth for "how intense was this delivery",
and we can ask a direct question of each rendering mode:

    does the SIZE the viewer sees separate strong delivery from normal?

Scored as ROC-AUC (0.5 = the channel carries nothing; 1.0 = perfect).

Two methodological points, both of which cost us the easy answer:

  * The AI arousal that drives size in full_ai comes from the audeering
    dimensional head, which we did not train — on RAVDESS it is an honest
    out-of-domain prediction, so full_ai is not being handicapped here.
  * The CATEGORY is a different story: our trained classifier was fitted on all
    480 of these clips, so its predictions on them are memorised. For the
    "when the classifier is wrong" analysis we therefore refit it under
    speaker-independent GroupKFold and use out-of-fold predictions instead.

    python scripts/compare_rendering.py
"""

from __future__ import annotations

import csv
import glob
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

CACHE = REPO / "data" / "timelines" / "ravdess_rendering_cache.npz"
OUT = REPO / "results" / "rendering_comparison.csv"

# RAVDESS filename: modality-vocal-EMOTION-INTENSITY-statement-repetition-ACTOR
EMOTION_BY_CODE = {
    "01": "neutral", "02": "calm", "03": "happy", "04": "sad",
    "05": "angry", "06": "fearful", "07": "disgust", "08": "surprised",
}


def collect() -> dict:
    """Prosody + AI dimensional output for every clip, cached."""
    if CACHE.exists():
        d = np.load(CACHE, allow_pickle=True)
        print(f"캐시 사용 → {CACHE.name} ({len(d['names'])}개)")
        return {k: d[k] for k in d.files}

    from backend.pipeline.emotion import classify_dimensional
    from backend.pipeline.prosody import extract_prosody

    files = sorted(glob.glob(str(REPO / "data/datasets/RAVDESS/Actor_*/*.wav")))
    print(f"{len(files)}개 클립 분석 중 (약 5분)…")
    names, pros, dims = [], [], []
    for i, f in enumerate(files, 1):
        try:
            p = asdict(extract_prosody(f).features)
            v, a, dom = classify_dimensional(f)
        except Exception as e:  # noqa: BLE001
            print(f"  건너뜀 {Path(f).name}: {e}")
            continue
        names.append(Path(f).name)
        pros.append(p)
        dims.append([v, a, dom])
        if i % 60 == 0:
            print(f"  {i}/{len(files)}")

    keys = sorted(pros[0])
    data = {
        "names": np.array(names),
        "prosody_keys": np.array(keys),
        "prosody": np.array([[float(p.get(k, 0.0)) for k in keys] for p in pros]),
        "dims": np.array(dims, dtype=float),
    }
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez(CACHE, **data)
    print(f"캐시 저장 → {CACHE.name}")
    return data


def out_of_fold_categories() -> dict:
    """Speaker-independent category predictions, so 'wrong' means wrong.

    The shipped classifier saw all of RAVDESS during fitting; asking it about
    these same clips would report memorisation, not accuracy.
    """
    from sklearn.model_selection import GroupKFold

    sys.path.insert(0, str(REPO / "scripts"))
    from build_runtime_classifiers import make_pipeline

    d = np.load(REPO / "data/timelines/ravdess_features.npz", allow_pickle=True)
    X, y, groups = d["X"], d["y"], d["groups"]
    pred = np.empty_like(y)
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
        clf = make_pipeline(probability=False)
        clf.fit(X[tr], y[tr])
        pred[te] = clf.predict(X[te])
    return {"true": y, "pred": pred, "correct": y == pred}


def main() -> int:
    from sklearn.metrics import roc_auc_score

    from backend.mapping.engine import map_emotion_to_visual
    from backend.mapping.reference import ProsodyReference

    data = collect()
    names = list(data["names"])
    keys = list(data["prosody_keys"])
    prosody = [dict(zip(keys, row)) for row in data["prosody"]]
    dims = data["dims"]

    strong = np.array([n.split("-")[3] == "02" for n in names]).astype(int)
    actors = np.array([n.split("-")[6].split(".")[0] for n in names])
    emo_code = [n.split("-")[2] for n in names]

    # One baseline per ACTOR — the RAVDESS analogue of "per video": same
    # speaker, same session, same recording level.
    baselines = {}
    for a in sorted(set(actors)):
        ref = ProsodyReference(min_segments=3)
        for i in np.where(actors == a)[0]:
            ref.update(prosody[i])
        baselines[a] = ref.snapshot()

    oof = out_of_fold_categories()
    print(f"\n화자 독립 카테고리 정확도: {oof['correct'].mean():.1%} "
          f"(틀린 클립 {int((~oof['correct']).sum())}개)")

    rows = []
    for i, name in enumerate(names):
        emotion = {
            "category": EMOTION_BY_CODE.get(emo_code[i], "neutral"),
            "valence": float(dims[i][0]),
            "arousal": float(dims[i][1]),
        }
        full = map_emotion_to_visual(emotion, prosody[i], None, "full_ai")
        hyb_abs = map_emotion_to_visual(emotion, prosody[i], None, "hybrid")
        hyb_rel = map_emotion_to_visual(
            emotion, prosody[i], baselines[actors[i]], "hybrid"
        )
        rows.append({
            "file": name, "actor": actors[i], "strong": strong[i],
            "classifier_correct": int(oof["correct"][i]),
            "ai_arousal": round(float(dims[i][1]), 4),
            "size_full_ai": round(full["size"], 4),
            "size_hybrid_abs": round(hyb_abs["size"], 4),
            "size_hybrid_rel": round(hyb_rel["size"], 4),
            "sat_full_ai": round(full["color"]["s"], 4),
            "sat_hybrid_rel": round(hyb_rel["color"]["s"], 4),
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    def auc(col, mask=None):
        v = np.array([r[col] for r in rows])
        yy = strong
        if mask is not None:
            v, yy = v[mask], yy[mask]
        if len(set(yy.tolist())) < 2:
            return float("nan")
        return roc_auc_score(yy, v)

    print(f"\n{'':34}{'크기 채널 AUC':>14}")
    print(f"{'전체 480개':34}")
    for label, col in [("  full_ai (AI arousal)", "size_full_ai"),
                       ("  hybrid (절대값)", "size_hybrid_abs"),
                       ("  hybrid (화자 기준선)", "size_hybrid_rel")]:
        print(f"{label:34}{auc(col):14.3f}")

    wrong = ~oof["correct"]
    print(f"\n{'분류기가 틀린 ' + str(int(wrong.sum())) + '개만':34}")
    for label, col in [("  full_ai (AI arousal)", "size_full_ai"),
                       ("  hybrid (화자 기준선)", "size_hybrid_rel")]:
        print(f"{label:34}{auc(col, wrong):14.3f}")

    right = oof["correct"]
    print(f"\n{'분류기가 맞힌 ' + str(int(right.sum())) + '개만':34}")
    for label, col in [("  full_ai (AI arousal)", "size_full_ai"),
                       ("  hybrid (화자 기준선)", "size_hybrid_rel")]:
        print(f"{label:34}{auc(col, right):14.3f}")

    print(f"\n채도 채널 AUC   full_ai {auc('sat_full_ai'):.3f} | "
          f"hybrid {auc('sat_hybrid_rel'):.3f}")

    # An AUC gap on 480 clips could be noise, and the subgroup split leaves
    # only 127 clips on the side that carries the argument — so the difference
    # is bootstrapped rather than eyeballed.
    full_v = np.array([r["size_full_ai"] for r in rows])
    hyb_v = np.array([r["size_hybrid_rel"] for r in rows])
    correct = np.array([r["classifier_correct"] for r in rows]).astype(bool)
    rng = np.random.default_rng(0)

    def bootstrap(mask, label, n=5000):
        yy, f, h = strong[mask], full_v[mask], hyb_v[mask]
        observed = roc_auc_score(yy, h) - roc_auc_score(yy, f)
        draws = []
        for _ in range(n):
            idx = rng.integers(0, len(yy), len(yy))
            if len(set(yy[idx].tolist())) < 2:
                continue
            draws.append(
                roc_auc_score(yy[idx], h[idx]) - roc_auc_score(yy[idx], f[idx])
            )
        draws = np.array(draws)
        lo, hi = np.percentile(draws, [2.5, 97.5])
        pval = 2 * min((draws <= 0).mean(), (draws >= 0).mean())
        print(f"  {label:20} n={int(mask.sum()):3d}  {observed:+.3f}  "
              f"95% CI [{lo:+.3f}, {hi:+.3f}]  p={pval:.4f}")

    print("\nhybrid − full_ai 차이 (부트스트랩 5000회)")
    bootstrap(np.ones(len(rows), bool), "전체")
    bootstrap(~correct, "분류기가 틀린 구간")
    bootstrap(correct, "분류기가 맞힌 구간")

    print(f"\n저장 → {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
