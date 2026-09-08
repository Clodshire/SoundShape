"""Aggregate the calibration sessions into the three answers worth reporting.

Run this after collecting. It prints a summary and writes a CSV per participant.

    python scripts/analyze_calibration.py

The three questions, in order of how much they matter:

1. DOES PERSONALISATION DESERVE TO EXIST?
   Only a crossover interaction can answer that: people should do better with
   the setting that matches their own profile, and worse with one that does
   not. A raw "everyone improved" is the evidence that learning-styles research
   offered before the idea collapsed under proper testing (Pashler et al. 2008)
   — it is equally explained by "wider ranges are just easier to see", which
   would mean fixing the defaults, not personalising.

2. HOW INTUITIVE IS EACH CHANNEL?
   The answer to "did you verify the mapping is intuitive", which the project
   currently cannot answer at all.

3. WHICH EMOTIONS GET CONFUSED?
   Points at the specific mapping rule to change. The config already flags
   fear=violet as a weakly-evidenced choice; this is how that gets settled.
"""

from __future__ import annotations

import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

SESSIONS = REPO / "data" / "calibration" / "sessions.jsonl"
OUT = REPO / "results" / "calibration_participants.csv"

CHANNEL_LABEL = {"hue": "색상", "shape": "모양", "size": "크기", "motion": "움직임"}


def load():
    if not SESSIONS.exists():
        return []
    rows = []
    with open(SESSIONS, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return rows


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact McNemar p-value for paired binary outcomes.

    b and c are the discordant pairs. Same test the embedding-swap experiment
    used, so the two results are comparable.
    """
    from math import comb

    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(comb(n, i) for i in range(k + 1)) / (2**n)
    return min(1.0, 2 * tail)


def main() -> int:
    sessions = load()
    if not sessions:
        print(f"세션이 없습니다 → {SESSIONS.relative_to(REPO)}")
        print("웹앱 /study 에서 검사를 진행하면 여기에 쌓입니다.")
        return 1

    print(f"참가자 {len(sessions)}명\n")

    # ── 2. per-channel intuitiveness ─────────────────────────────────
    per = defaultdict(lambda: {"discrimination": [], "semantic": []})
    for s in sessions:
        for ch, kinds in (s.get("scores") or {}).items():
            for kind in ("discrimination", "semantic"):
                acc = kinds.get(kind, {}).get("accuracy")
                if acc is not None:
                    per[ch][kind].append(acc)

    print("② 채널별 정확도 (구분 = 보이는가 · 의미 = 뜻을 아는가)")
    print(f"   {'채널':8}{'구분':>10}{'의미':>10}   진단")
    for ch in ("hue", "shape", "size", "motion"):
        d, m = per[ch]["discrimination"], per[ch]["semantic"]
        if not d and not m:
            continue
        dm = sum(d) / len(d) if d else float("nan")
        mm = sum(m) / len(m) if m else float("nan")
        if dm < 0.6:
            note = "안 보임 → 표현 폭을 넓혀야"
        elif mm < 0.6:
            note = "보이지만 뜻이 안 통함 → 매핑 재검토"
        else:
            note = "정상"
        print(f"   {CHANNEL_LABEL[ch]:8}{dm:10.1%}{mm:10.1%}   {note}")

    # ── 1. does personalisation deserve to exist? ────────────────────
    best = defaultdict(int)
    for s in sessions:
        top, top_acc = None, -1.0
        for ch, kinds in (s.get("scores") or {}).items():
            acc = kinds.get("semantic", {}).get("accuracy")
            if acc is not None and acc > top_acc:
                top, top_acc = ch, acc
        if top:
            best[top] += 1
    print("\n① 사람마다 잘 읽는 채널이 다른가")
    for ch, n in sorted(best.items(), key=lambda kv: -kv[1]):
        print(f"   {CHANNEL_LABEL.get(ch, ch):8}{n:3d}명")
    if len(best) <= 1:
        print("   → 모두 같은 채널이 최고. 개인 맞춤이 아니라 기본값을 고치는 게 맞음")
    else:
        print("   → 사람마다 다름. 개인 맞춤이 정당화됨")

    # crossover, paired within participant
    b = c = 0          # b: personal only correct, c: default only correct
    dn = pn = dc = pc = 0
    for s in sessions:
        cross = s.get("crossover") or []
        d_res = [x for x in cross if x.get("condition") == "default"]
        p_res = [x for x in cross if x.get("condition") == "personal"]
        dn += len(d_res); pn += len(p_res)
        dc += sum(1 for x in d_res if x.get("correct"))
        pc += sum(1 for x in p_res if x.get("correct"))
        for d_t, p_t in zip(d_res, p_res):
            if p_t.get("correct") and not d_t.get("correct"):
                b += 1
            elif d_t.get("correct") and not p_t.get("correct"):
                c += 1
    if dn:
        print(f"\n   교차 검증  기본 {dc}/{dn} ({dc/dn:.1%})  ·  "
              f"맞춤 {pc}/{pn} ({pc/pn:.1%})")
        print(f"   불일치 쌍  맞춤만 정답 {b} · 기본만 정답 {c}  "
              f"→ McNemar p = {mcnemar_exact(b, c):.4f}")
        if b + c < 10:
            print("   ⚠️ 불일치 쌍이 너무 적어 결론을 내릴 수 없습니다 (10쌍 이상 권장)")
    else:
        print("\n   교차 검증 데이터 없음 — /study 의 연구 모드로 수집해야 합니다")

    # ── 3. confusions ────────────────────────────────────────────────
    conf = defaultdict(lambda: defaultdict(int))
    for s in sessions:
        for t in s.get("trials", []):
            if t.get("kind") == "semantic" and not t.get("correct"):
                truth, ans = t.get("expected"), t.get("answer")
                if truth and ans and truth not in ("left", "right"):
                    if ans not in ("left", "right", "__unsure__"):
                        conf[truth][ans] += 1
    if conf:
        print("\n③ 자주 헷갈린 조합 (실제 → 답변)")
        flat = [(a, b_, n) for a, d in conf.items() for b_, n in d.items()]
        for a, b_, n in sorted(flat, key=lambda x: -x[2])[:8]:
            print(f"   {a:10} → {b_:10} {n}회")

    # ── per-participant CSV ──────────────────────────────────────────
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        cols = ["id", "created", "mode", "group"]
        for ch in ("hue", "shape", "size", "motion"):
            cols += [f"{ch}_discrim", f"{ch}_semantic"]
        cols += ["w_saturation", "w_lightness", "w_size", "w_motion",
                 "cross_default_correct", "cross_default_n",
                 "cross_personal_correct", "cross_personal_n"]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for s in sessions:
            row = {
                "id": s.get("id"), "created": s.get("created"),
                "mode": s.get("mode"), "group": s.get("participant_group"),
            }
            for ch in ("hue", "shape", "size", "motion"):
                sc = (s.get("scores") or {}).get(ch, {})
                row[f"{ch}_discrim"] = sc.get("discrimination", {}).get("accuracy")
                row[f"{ch}_semantic"] = sc.get("semantic", {}).get("accuracy")
            for g in ("saturation", "lightness", "size", "motion"):
                row[f"w_{g}"] = (s.get("weights") or {}).get(g)
            cross = s.get("crossover") or []
            for cond in ("default", "personal"):
                sub = [x for x in cross if x.get("condition") == cond]
                row[f"cross_{cond}_n"] = len(sub)
                row[f"cross_{cond}_correct"] = sum(1 for x in sub if x.get("correct"))
            w.writerow(row)
    print(f"\n저장 → {OUT.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
