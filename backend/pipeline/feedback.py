"""Store for the low-confidence feedback loop.

When the classifier is unsure about a segment we keep the numeric feature
vector it computed (1024-d embedding + 14 prosody values) and hand the client
an opaque id. If the viewer later tells us how that moment felt, the answer is
joined back to those features and becomes in-domain training data — which is
the one thing no public dataset can give us for Korean drama.

Two deliberate properties:

* **Audio is never stored.** Only the feature vector, from which the original
  voice cannot be reconstructed. The client never receives the vector either —
  it only ever sees the id, so the numbers stay on the server.
* **Only uncertain segments are kept.** Confident ones are discarded, so the
  store stays small (~100KB per 20-minute video) and holds exactly the
  examples that carry the most learning signal.

Layout (JSON Lines, append-only so a crash can never corrupt earlier rows):
    data/feedback/pending.jsonl   features awaiting an answer
    data/feedback/labels.jsonl    answers, joined by id
"""

from __future__ import annotations

import base64
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

import numpy as np

REPO = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = REPO / "config" / "feedback_config.json"
STORE_DIR = REPO / "data" / "feedback"
PENDING = STORE_DIR / "pending.jsonl"
LABELS = STORE_DIR / "labels.jsonl"

# Appends are serialized; the store is tiny and writes are rare, so a plain
# lock is simpler and safer than anything fancier.
_lock = threading.Lock()


# ── config ───────────────────────────────────────────────────────────


def load_config() -> Dict[str, Any]:
    """Read the feedback config (uncached so edits apply without a restart)."""
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a bad config must not break serving
        return {"enabled": False}


def client_config() -> Dict[str, Any]:
    """The subset a browser needs. Internal keys and `_doc` notes are stripped."""
    cfg = load_config()
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "display_seconds": cfg.get("display_seconds", 8),
        "min_interval_seconds": cfg.get("min_interval_seconds", 120),
        "max_prompts_per_video": cfg.get("max_prompts_per_video", 5),
        "question": cfg.get("question", ""),
        "options": cfg.get("options", []),
        "unsure_value": cfg.get("unsure_value", "unsure"),
        "unsure_label": cfg.get("unsure_label", ""),
    }


def should_ask(confidence: float) -> bool:
    cfg = load_config()
    if not cfg.get("enabled", False):
        return False
    return float(confidence) < float(cfg.get("trigger_below", 0.45))


# ── feature (de)serialization ────────────────────────────────────────


def _encode(features: np.ndarray) -> str:
    """float32 → base64. ~5.5KB per record vs ~20KB as JSON numbers."""
    return base64.b64encode(np.asarray(features, dtype=np.float32).tobytes()).decode()


def _decode(blob: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(blob), dtype=np.float32)


# ── writing ──────────────────────────────────────────────────────────


def _append(path: Path, record: Dict[str, Any]) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def register_pending(
    features: np.ndarray,
    predicted: str,
    confidence: float,
    *,
    language: Optional[str] = None,
    embedding_model: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Stash the features for an uncertain segment; return its id (or None).

    Returns None when feedback is disabled or anything goes wrong — the caller
    treats that as "don't ask", so analysis is never blocked by this feature.
    """
    try:
        cfg = load_config()
        if not cfg.get("enabled", False):
            return None
        fid = "fb_" + uuid.uuid4().hex[:12]
        record = {
            "id": fid,
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "predicted": predicted,
            "confidence": round(float(confidence), 4),
            "language": language,
            "embedding_model": embedding_model,
            "features": _encode(features),
        }
        if context:
            # Small, non-identifying context for debugging and de-duplication.
            for key in ("source", "t", "duration", "text"):
                if key in context:
                    record[key] = context[key]
        _append(PENDING, record)
        return fid
    except Exception:  # noqa: BLE001
        return None


def record_label(
    feedback_id: str, label: str, response_ms: Optional[int] = None
) -> bool:
    """Store a viewer's answer. False if the id is unknown."""
    if not feedback_id or not label:
        return False
    if not _pending_index().get(feedback_id):
        return False
    _append(
        LABELS,
        {
            "id": feedback_id,
            "label": label,
            "response_ms": response_ms,
            "answered": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
    )
    return True


# ── reading ──────────────────────────────────────────────────────────


def _iter_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    if not path.exists():
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue  # tolerate a torn final line


def _pending_index() -> Dict[str, Dict[str, Any]]:
    return {r["id"]: r for r in _iter_jsonl(PENDING) if "id" in r}


def _answers() -> Dict[str, Dict[str, Any]]:
    """Last answer wins, so a viewer can correct themselves."""
    out: Dict[str, Dict[str, Any]] = {}
    for r in _iter_jsonl(LABELS):
        if "id" in r:
            out[r["id"]] = r
    return out


def load_training_pairs(
    *, include_holdout: bool = False
) -> Tuple[np.ndarray, np.ndarray, List[Dict[str, Any]]]:
    """Answered records as (X, y, meta), with quality filtering applied.

    Dropped: "not sure", answers faster than `min_response_ms` (careless), and
    — unless `include_holdout` — labels held out of training because the model
    has no such class yet (sarcasm, until enough examples exist).
    """
    cfg = load_config()
    unsure = cfg.get("unsure_value", "unsure")
    min_ms = int(cfg.get("min_response_ms", 0))
    holdout = set(cfg.get("holdout_labels", []))

    pending = _pending_index()
    rows_X, rows_y, meta = [], [], []
    for fid, ans in _answers().items():
        rec = pending.get(fid)
        if rec is None:
            continue
        label = ans.get("label")
        if not label or label == unsure:
            continue
        rt = ans.get("response_ms")
        if rt is not None and min_ms and int(rt) < min_ms:
            continue
        if not include_holdout and label in holdout:
            continue
        rows_X.append(_decode(rec["features"]))
        rows_y.append(label)
        meta.append({
            "id": fid,
            "predicted": rec.get("predicted"),
            "confidence": rec.get("confidence"),
            "language": rec.get("language"),
            "embedding_model": rec.get("embedding_model"),
        })

    if not rows_X:
        return np.empty((0, 0), dtype=np.float32), np.empty((0,), dtype=object), []
    return np.vstack(rows_X), np.array(rows_y, dtype=object), meta


def stats() -> Dict[str, Any]:
    """Counts for the API / retrain readiness."""
    cfg = load_config()
    pending = _pending_index()
    answers = _answers()
    by_label: Dict[str, int] = {}
    for a in answers.values():
        lab = a.get("label", "?")
        by_label[lab] = by_label.get(lab, 0) + 1

    X, y, _ = load_training_pairs()
    holdout = set(cfg.get("holdout_labels", []))
    return {
        "pending": len(pending),
        "answered": len(answers),
        "usable_for_training": int(len(y)),
        "by_label": by_label,
        "holdout": {
            lab: by_label.get(lab, 0) for lab in holdout
        },
        "holdout_min_count": cfg.get("holdout_min_count", 30),
    }


# ── retention ────────────────────────────────────────────────────────


def prune(now: Optional[float] = None) -> int:
    """Drop unanswered records past their TTL, and cap the store size.

    Answered records are always kept — those are the training data.
    Returns how many rows were removed.
    """
    cfg = load_config()
    ttl_days = int(cfg.get("pending_ttl_days", 30))
    max_pending = int(cfg.get("max_pending", 5000))
    if not PENDING.exists():
        return 0

    answered = set(_answers().keys())
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    rows = list(_iter_jsonl(PENDING))

    kept: List[Dict[str, Any]] = []
    for r in rows:
        if r.get("id") in answered:
            kept.append(r)
            continue
        try:
            created = datetime.fromisoformat(r["created"])
        except Exception:  # noqa: BLE001 — undated row, keep it
            kept.append(r)
            continue
        if created >= cutoff:
            kept.append(r)

    # Cap: keep answered rows plus the most recent unanswered ones.
    if len(kept) > max_pending:
        answered_rows = [r for r in kept if r.get("id") in answered]
        other = [r for r in kept if r.get("id") not in answered]
        room = max(0, max_pending - len(answered_rows))
        kept = answered_rows + other[-room:]

    removed = len(rows) - len(kept)
    if removed:
        with _lock:
            tmp = PENDING.with_suffix(".jsonl.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                for r in kept:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            tmp.replace(PENDING)
    return removed
