"""Retrain the emotion classifiers on viewer feedback — with a quality gate.

The model learned from AIHub conversational speech, but people watch dramas.
That domain gap is the main reason Korean accuracy sits at 49.6%, and no public
dataset can close it. Viewer answers collected at low-confidence moments are
exactly the missing data, so this folds them back into the model.

Retraining is deliberately a **manual, gated** step rather than something that
happens automatically. A bad batch of labels would otherwise silently degrade
the product with nobody noticing. So this script always:

    1. compares fairly — baseline and candidate are trained on the same base
       split, and both are scored on data neither has seen
    2. checks two things — did it improve on the drama domain, and did it
       regress on the original dataset
    3. refuses to ship a worse model

Only if both checks pass is a final model refit on everything and installed.

    python scripts/retrain_with_feedback.py            # evaluate + install
    python scripts/retrain_with_feedback.py --dry-run  # evaluate only
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
from joblib import dump
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from backend.pipeline import feedback as fb  # noqa: E402
from scripts.build_runtime_classifiers import (  # noqa: E402
    AUDEERING,
    EMB_DIM,
    PROSODY_KEYS,
    XLSR_KOREAN,
    make_pipeline,
)

TIMELINES = REPO / "data" / "timelines"
MODELS = REPO / "backend" / "models"

SEED = 0
FEEDBACK_WEIGHT = 3.0     # in-domain labels count for more than base data
MIN_FEEDBACK = 30         # below this, any measured difference is noise
MIN_TEST = 10             # need a meaningful held-out set to judge on
BASE_TEST_FRACTION = 0.2
FEEDBACK_TEST_FRACTION = 0.3
MAX_BASE_REGRESSION = 0.02  # tolerate ≤2%p drop on the original dataset

# bundle filename → (embedding model it was built with, base data loader key)
TARGETS = {
    "korean_clf.joblib": (XLSR_KOREAN, "ko"),
    "emotion_clf.joblib": (AUDEERING, "en"),
}


# ── base datasets ────────────────────────────────────────────────────


def load_base(kind: str) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    if kind == "en":
        p = TIMELINES / "ravdess_features.npz"
        if not p.exists():
            return None
        d = np.load(p, allow_pickle=True)
        return d["X"], d["y"]

    feats = TIMELINES / "korean_features.npz"
    emb = TIMELINES / f"korean_emb_{XLSR_KOREAN.replace('/', '__')}.npz"
    if not feats.exists() or not emb.exists():
        return None
    d = np.load(feats, allow_pickle=True)
    prosody = d["X"][:, EMB_DIM:]
    E = np.load(emb)["E"]
    return np.hstack([E.astype(prosody.dtype), prosody]), d["y"]


# ── evaluation ───────────────────────────────────────────────────────


def fit(
    X: np.ndarray,
    y: np.ndarray,
    weights: Optional[np.ndarray] = None,
    *,
    probability: bool = False,
):
    """Fit a pipeline.

    Comparison models are scored with `predict()` only, so they skip the
    expensive probability calibration; just the final model that gets served
    is fitted with it.
    """
    clf = make_pipeline(probability=probability)
    t0 = time.perf_counter()
    if weights is None:
        clf.fit(X, y)
    else:
        clf.fit(X, y, svm__sample_weight=weights)
    print(f"    fit {X.shape[0]}×{X.shape[1]}"
          f"{' (+proba)' if probability else ''} — {time.perf_counter() - t0:.0f}s",
          flush=True)
    return clf


def score(clf, X: np.ndarray, y: np.ndarray) -> float:
    if len(y) == 0:
        return float("nan")
    return float(accuracy_score(y, clf.predict(X)))


def evaluate_target(
    filename: str, embedding_model: str, base_kind: str
) -> Optional[Dict]:
    """Fair baseline-vs-candidate comparison for one classifier."""
    base = load_base(base_kind)
    if base is None:
        print(f"  base dataset missing — skipping")
        return None
    Xb, yb = base

    # Feedback must come from the same embedding space as this bundle;
    # vectors from a different backbone are not comparable.
    Xf_all, yf_all, meta = fb.load_training_pairs()
    keep = [i for i, m in enumerate(meta)
            if m.get("embedding_model") == embedding_model]
    if len(keep) < MIN_FEEDBACK:
        print(f"  usable feedback: {len(keep)} (need {MIN_FEEDBACK}) — skipping")
        return None
    Xf, yf = Xf_all[keep], yf_all[keep]

    if Xf.shape[1] != Xb.shape[1]:
        print(f"  feature width mismatch: feedback {Xf.shape[1]} vs base "
              f"{Xb.shape[1]} — skipping")
        return None

    # Held-out sets neither model sees. Stratify when every class allows it.
    def split(X, y, frac):
        strat = y if min(np.bincount(np.unique(y, return_inverse=True)[1])) >= 2 else None
        return train_test_split(X, y, test_size=frac, random_state=SEED,
                                stratify=strat)

    Xb_tr, Xb_te, yb_tr, yb_te = split(Xb, yb, BASE_TEST_FRACTION)
    Xf_tr, Xf_te, yf_tr, yf_te = split(Xf, yf, FEEDBACK_TEST_FRACTION)
    if len(yf_te) < MIN_TEST:
        print(f"  held-out feedback too small ({len(yf_te)} < {MIN_TEST}) — skipping")
        return None

    print(f"  base {len(yb)} (test {len(yb_te)}) · "
          f"feedback {len(yf)} (test {len(yf_te)})", flush=True)

    baseline = fit(Xb_tr, yb_tr)
    X_cand = np.vstack([Xb_tr, Xf_tr])
    y_cand = np.concatenate([yb_tr, yf_tr])
    w = np.concatenate([np.ones(len(yb_tr)),
                        np.full(len(yf_tr), FEEDBACK_WEIGHT)])
    candidate = fit(X_cand, y_cand, w)

    return {
        "filename": filename,
        "embedding_model": embedding_model,
        "base_kind": base_kind,
        "n_base": int(len(yb)),
        "n_feedback": int(len(yf)),
        "domain_before": score(baseline, Xf_te, yf_te),
        "domain_after": score(candidate, Xf_te, yf_te),
        "base_before": score(baseline, Xb_te, yb_te),
        "base_after": score(candidate, Xb_te, yb_te),
        "_full": (Xb, yb, Xf, yf),
    }


def decide(r: Dict) -> Tuple[bool, str]:
    """Ship only on a real domain gain without meaningful regression."""
    gain = r["domain_after"] - r["domain_before"]
    drop = r["base_before"] - r["base_after"]
    if gain <= 0:
        return False, f"도메인 개선 없음 ({gain:+.1%})"
    if drop > MAX_BASE_REGRESSION:
        return False, (f"기존 데이터 성능 하락이 허용치를 초과 "
                       f"(-{drop:.1%} > {MAX_BASE_REGRESSION:.0%})")
    return True, f"개선 확인 ({gain:+.1%})"


def install(r: Dict) -> None:
    """Refit on everything and replace the bundle (previous one is backed up)."""
    Xb, yb, Xf, yf = r["_full"]
    X = np.vstack([Xb, Xf])
    y = np.concatenate([yb, yf])
    w = np.concatenate([np.ones(len(yb)), np.full(len(yf), FEEDBACK_WEIGHT)])
    # The served model needs calibrated confidence — it drives the neutral/gray
    # rendering and decides when to ask the viewer for feedback.
    final = fit(X, y, w, probability=True)

    path = MODELS / r["filename"]
    if path.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = path.with_suffix(f".joblib.{stamp}.bak")
        shutil.copy2(path, backup)
        print(f"    이전 모델 백업 → {backup.name}")

    dump({
        "pipeline": final,
        "embedding_model": r["embedding_model"],
        "prosody_keys": PROSODY_KEYS,
        "emb_dim": EMB_DIM,
        "classes": sorted(set(y.tolist())),
        "trained_on": f"{r['base_kind']} base + {r['n_feedback']} viewer labels",
        "n_samples": int(len(y)),
        "retrained_at": datetime.now().isoformat(timespec="seconds"),
    }, path)
    print(f"    새 모델 설치 완료 → {path.name} (서버 재시작 불필요)")


def report(r: Dict, shipped: bool, reason: str) -> None:
    print()
    print(f"  {'':<14}{'기존':>10}{'후보':>12}")
    print(f"  {'-' * 36}")
    print(f"  {'드라마 도메인':<12}{r['domain_before']:>9.1%}"
          f"{r['domain_after']:>12.1%}"
          f"   ({r['domain_after'] - r['domain_before']:+.1%})")
    print(f"  {'기존 데이터':<13}{r['base_before']:>9.1%}"
          f"{r['base_after']:>12.1%}"
          f"   ({r['base_after'] - r['base_before']:+.1%})")
    print()
    print(f"  {'✅' if shipped else '⛔'} {reason}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="평가만 하고 모델을 교체하지 않음")
    args = ap.parse_args()

    s = fb.stats()
    print("사용자 피드백 현황")
    print(f"  대기 {s['pending']} · 응답 {s['answered']} · "
          f"학습 가능 {s['usable_for_training']}")
    for label, n in s["holdout"].items():
        need = s["holdout_min_count"]
        state = "학습 포함 가능" if n >= need else f"{need}개 필요 — 보류 중"
        print(f"  보류 라벨 '{label}': {n}개 ({state})")
    print()

    installed = 0
    for filename, (embedding_model, base_kind) in TARGETS.items():
        print(f"[{base_kind}] {filename}", flush=True)
        r = evaluate_target(filename, embedding_model, base_kind)
        if r is None:
            print()
            continue
        shipped, reason = decide(r)
        report(r, shipped, reason)
        if shipped and not args.dry_run:
            install(r)
            installed += 1
        elif shipped:
            print("    (--dry-run: 설치 생략)")
        print()

    if installed:
        print(f"{installed}개 모델이 갱신되었습니다.")
    else:
        print("갱신된 모델이 없습니다. 기존 모델을 그대로 사용합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
