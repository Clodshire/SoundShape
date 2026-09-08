"""Personal calibration — measuring how well a viewer reads each visual channel.

The mapping is grounded in published research, but whether a given person
actually reads it that way has never been measured. This module measures it,
one participant at a time, and turns the result into per-channel weights.

Two trial kinds, because a channel can fail for two opposite reasons:

    discrimination   "are these two the same?"      → is the difference VISIBLE
    semantic         "which emotion is this?"       → does the difference MEAN anything

A channel that is visible but meaningless cannot be fixed by making it louder —
a violet that says nothing about fear says nothing about fear when saturated.
That case gets its load shifted elsewhere. A channel that is meaningful but not
visible is the opposite case, and widening its range is exactly the fix.

Weights are never driven to zero. Redundant coding measurably helps accuracy
and speed (Miller 1982), and a channel kept alive at low weight is what remains
when the strong one is unavailable — a dark scene, a small screen.

Store layout mirrors the feedback loop (JSON Lines, append-only):
    data/calibration/sessions.jsonl
"""

from __future__ import annotations

import json
import threading
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = REPO / "config" / "calibration_config.json"
STORE_DIR = REPO / "data" / "calibration"
SESSIONS = STORE_DIR / "sessions.jsonl"

_lock = threading.Lock()


# ── config ───────────────────────────────────────────────────────────


def load_config() -> Dict[str, Any]:
    """Read the calibration config (uncached, so edits apply without a restart)."""
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a bad config must not break serving
        return {"enabled": False}


def client_config() -> Dict[str, Any]:
    """The subset a browser needs to run the test. `_doc` notes are stripped."""
    cfg = load_config()
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "version": cfg.get("version", ""),
        "channels": cfg.get("channels", {}),
        "trials": cfg.get("trials", {}),
        "emotions": cfg.get("emotions", []),
        "questions": cfg.get("questions", {}),
        "min_response_ms": cfg.get("min_response_ms", 0),
    }


# ── scoring ──────────────────────────────────────────────────────────


def score_channels(trials: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per-channel accuracy, split by trial kind.

    Careless answers are dropped first, on the same rule the feedback loop
    uses: a response faster than the floor was not a judgement.
    """
    min_ms = int(load_config().get("min_response_ms", 0))
    buckets: Dict[str, Dict[str, List[bool]]] = defaultdict(
        lambda: {"discrimination": [], "semantic": []}
    )
    for t in trials:
        kind = t.get("kind")
        channel = t.get("channel")
        if kind not in ("discrimination", "semantic") or not channel:
            continue
        rt = t.get("response_ms")
        if rt is not None and min_ms and int(rt) < min_ms:
            continue
        buckets[channel][kind].append(bool(t.get("correct")))

    out: Dict[str, Dict[str, Any]] = {}
    for channel, kinds in buckets.items():
        entry: Dict[str, Any] = {}
        for kind, results in kinds.items():
            entry[kind] = {
                "n": len(results),
                "accuracy": (sum(results) / len(results)) if results else None,
            }
        out[channel] = entry
    return out


def derive_weights(scores: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
    """Channel scores → gain multipliers, following the diagnosis table.

        visible + meaningful   → 1.0   leave alone
        visible, not meaningful→ 0.6   shift the load off this channel
        not visible            → 1.4   widen the range so differences clear the JND

    A channel with no adjustable gain (shape is categorical) cannot be acted on
    directly, so when it fails semantically its share is spread over the
    channels that do have a knob — the redistribution the design promises.
    """
    cfg = load_config()
    w_cfg = cfg.get("weights", {})
    channels = cfg.get("channels", {})
    neutral = float(w_cfg.get("neutral", 1.0))
    boost = float(w_cfg.get("boost", 1.4))
    reduce = float(w_cfg.get("reduce", 0.6))
    share = float(w_cfg.get("redistribute_share", 0.2))
    lo = float(w_cfg.get("min", 0.6))
    hi = float(w_cfg.get("max", 1.4))
    threshold = float(w_cfg.get("pass_threshold", 0.6))

    adjustable = {
        name: meta["adjustable"]
        for name, meta in channels.items()
        if meta.get("adjustable")
    }
    weights = {gain: neutral for gain in adjustable.values()}
    # lightness tracks valence, which a participant cannot verify by eye, so it
    # is never tested — and an untested channel must not receive redistributed
    # load either. It is emitted at the default purely so callers see the full
    # set of gains rather than having to know which ones were omitted.
    untested = {"lightness"}

    def passed(channel: str, kind: str) -> Optional[bool]:
        acc = scores.get(channel, {}).get(kind, {}).get("accuracy")
        return None if acc is None else acc >= threshold

    orphaned = 0.0
    for channel in channels:
        sees = passed(channel, "discrimination")
        means = passed(channel, "semantic")
        gain = adjustable.get(channel)
        if sees is False:
            if gain:
                weights[gain] = boost
            continue
        if means is False:
            if gain:
                weights[gain] = reduce
            else:
                # No knob to turn — hand this channel's job to the others.
                orphaned += share

    if orphaned:
        # Only channels that are working get more to do; piling load onto one
        # that already failed would make the display worse, not better.
        receivers = [g for g in weights if weights[g] >= neutral]
        for gain in receivers:
            weights[gain] += orphaned

    out = {g: round(max(lo, min(hi, v)), 3) for g, v in weights.items()}
    for gain in untested:
        out.setdefault(gain, neutral)
    return out


# ── store ────────────────────────────────────────────────────────────


def _append(record: Dict[str, Any]) -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        with open(SESSIONS, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def record_session(
    trials: List[Dict[str, Any]],
    *,
    mode: str = "short",
    participant_group: Optional[str] = None,
    crossover: Optional[List[Dict[str, Any]]] = None,
    note: Optional[str] = None,
    store: bool = True,
) -> Dict[str, Any]:
    """Score a run and return the weights it produced; store it unless told not to.

    `store=False` exists for the research flow, which has to score the
    measurement block mid-test to build the crossover block from the resulting
    weights. Writing there too would file every full run as two participants
    and count the same answers twice in the aggregate.
    """
    scores = score_channels(trials)
    weights = derive_weights(scores)
    if not store:
        return {"id": None, "scores": scores, "weights": weights}
    record = {
        "id": "cal_" + uuid.uuid4().hex[:12],
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "participant_group": participant_group,
        "note": note,
        "trials": trials,
        "scores": scores,
        "weights": weights,
        "crossover": crossover or [],
    }
    _append(record)
    return {"id": record["id"], "scores": scores, "weights": weights}


def _EMOTIONS() -> set:
    return set(load_config().get("emotions", []))


def _iter_sessions():
    if not SESSIONS.exists():
        return
    with open(SESSIONS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue  # tolerate a torn final line


def stats() -> Dict[str, Any]:
    """Aggregate across participants — the part that is actually research data.

    Three questions, in order of how much they matter:

    1. Do people differ in which channel works for them? If the ranking is the
       same for everyone, personalisation has no reason to exist and the honest
       move is to fix the defaults instead.
    2. How intuitive is each channel, population-wide? This is the answer to
       "did you verify the mapping is intuitive", which currently has none.
    3. Which emotions get confused with which? That points at the specific
       mapping rule to change.
    """
    sessions = list(_iter_sessions())
    per_channel: Dict[str, Dict[str, List[float]]] = defaultdict(
        lambda: {"discrimination": [], "semantic": []}
    )
    rankings: Dict[str, int] = defaultdict(int)
    confusion: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    crossover = {"default_correct": 0, "default_n": 0,
                 "personal_correct": 0, "personal_n": 0}

    for s in sessions:
        for channel, kinds in (s.get("scores") or {}).items():
            for kind in ("discrimination", "semantic"):
                acc = kinds.get(kind, {}).get("accuracy")
                if acc is not None:
                    per_channel[channel][kind].append(acc)
        # Which channel this participant read best, semantically.
        best, best_acc = None, -1.0
        for channel, kinds in (s.get("scores") or {}).items():
            acc = kinds.get("semantic", {}).get("accuracy")
            if acc is not None and acc > best_acc:
                best, best_acc = channel, acc
        if best:
            rankings[best] += 1
        for t in s.get("trials", []):
            if t.get("kind") != "semantic" or t.get("correct"):
                continue
            truth, answer = t.get("expected"), t.get("answer")
            # Intensity trials answer "left"/"right", which is not a confusion
            # between emotions — mixing them in would make the matrix unusable
            # for finding which mapping rule is weak.
            if truth in _EMOTIONS() and answer in _EMOTIONS():
                confusion[truth][answer] += 1
        for c in s.get("crossover", []):
            cond = c.get("condition")
            if cond in ("default", "personal"):
                crossover[f"{cond}_n"] += 1
                if c.get("correct"):
                    crossover[f"{cond}_correct"] += 1

    def mean(xs):
        return round(sum(xs) / len(xs), 4) if xs else None

    return {
        "participants": len(sessions),
        "channel_accuracy": {
            ch: {k: {"mean": mean(v[k]), "n": len(v[k])}
                 for k in ("discrimination", "semantic")}
            for ch, v in per_channel.items()
        },
        "best_channel_counts": dict(rankings),
        "confusions": {k: dict(v) for k, v in confusion.items()},
        "crossover": crossover,
    }
