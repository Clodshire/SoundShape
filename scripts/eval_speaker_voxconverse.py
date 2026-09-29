"""화자 전환 대시를 VoxConverse 2인 대화로 채점한다.

`eval_speaker.py` 가 RAVDESS 로는 답할 수 없다고 결론 낸 질문 — 자막 구간과
결합한 전 과정이 실제 대화에서 맞는가 — 을 공개 데이터셋으로 답한다.
VoxConverse 는 유튜브에서 뽑은 실제 대화이고 RTTM 정답이 딸려 있어, 사람이
라벨을 매길 필요가 없다.

    python scripts/eval_speaker_voxconverse.py crixb tiido

■ 정답을 맞추는 방법

우리 예측은 **Whisper 구간** 단위이고 정답은 **RTTM 구간** 단위라 경계가 다르다.
그래서 Whisper 구간마다 그 시간대에 가장 오래 말한 화자를 정답 화자로 삼고,
이웃한 두 구간의 정답 화자가 다르면 "실제로 전환이 있었다" 로 센다. 이 기능이
주장하는 것이 딱 그것이기 때문이다 — 누가 말하는지가 아니라, 바뀌었는지.

■ 겹쳐 말하기

VoxConverse 에는 두 사람이 동시에 말하는 구간이 있다. 그런 구간에서 "화자가
누구인가" 는 답이 하나로 정해지지 않으므로, 2등 화자의 발화가 1등의
`--overlap-tol` (기본 0.5) 배를 넘으면 그 구간은 **채점에서 제외**하고 따로
보고한다. 애매한 것을 조용히 한쪽으로 밀어 넣으면 숫자가 실제보다 좋아진다.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
VOX = REPO / "data" / "datasets" / "VoxConverse"
API = "http://localhost:8000"


def load_rttm(clip: str) -> list[tuple[float, float, str]]:
    """(시작, 끝, 화자) 목록."""
    path = VOX / "rttm_dev" / f"{clip}.rttm"
    if not path.exists():
        sys.exit(f"RTTM 이 없습니다: {path}")
    out = []
    for line in path.read_text().splitlines():
        p = line.split()
        if len(p) < 8:
            continue
        st, dur = float(p[3]), float(p[4])
        out.append((st, st + dur, p[7]))
    return sorted(out)


def truth_speaker(
    rttm: list[tuple[float, float, str]], start: float, end: float, tol: float
) -> tuple[str | None, bool]:
    """구간을 지배한 화자와, 겹쳐 말하기로 애매한지 여부."""
    talk: dict[str, float] = defaultdict(float)
    for st, en, spk in rttm:
        ov = min(end, en) - max(start, st)
        if ov > 0:
            talk[spk] += ov
    if not talk:
        return None, False  # 아무도 말하지 않음 (음악·잡음 구간)
    ranked = sorted(talk.items(), key=lambda kv: -kv[1])
    if len(ranked) > 1 and ranked[1][1] > ranked[0][1] * tol:
        return ranked[0][0], True  # 겹침이 심해 애매
    return ranked[0][0], False


def segments_for(clip: str) -> list[dict]:
    wav = VOX / "audio_dev" / f"{clip}.wav"
    if not wav.exists():
        sys.exit(f"오디오가 없습니다: {wav}")
    resp = requests.post(
        f"{API}/process/stream", files={"file": wav.open("rb")},
        data={"language": "en"}, stream=True, timeout=3600,
    )
    resp.raise_for_status()
    segs = []
    for raw in resp.iter_lines():
        if not raw:
            continue
        line = raw.decode("utf-8", "replace").strip().removeprefix("data:").strip()
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "text" in o:
            segs.append(o)
    return segs


def score_clip(clip: str, tol: float, verbose: bool) -> dict:
    rttm = load_rttm(clip)
    print(f"\n── {clip} ─────────────────────────────")
    print(f"  RTTM: 발화 {len(rttm)}개 · 화자 {len({s for _,_,s in rttm})}명")
    segs = segments_for(clip)
    print(f"  파이프라인: 구간 {len(segs)}개")

    rows = []
    for s in segs:
        t = float(s.get("t", 0.0))
        d = float(s.get("duration", 0.0))
        spk, ambiguous = truth_speaker(rttm, t, t + d, tol)
        rows.append({
            "t": t, "text": (s.get("text") or "").strip(),
            "pred": bool(s.get("speaker_changed")),
            "spk": spk, "ambiguous": ambiguous,
        })

    tp = fp = fn = tn = 0
    skipped = 0
    wrong = []
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        if a["spk"] is None or b["spk"] is None or a["ambiguous"] or b["ambiguous"]:
            skipped += 1
            continue
        truth = a["spk"] != b["spk"]
        if b["pred"] and truth:
            tp += 1
        elif b["pred"] and not truth:
            fp += 1
            wrong.append(f"    오탐 t={b['t']:6.1f}s ({a['spk']}→{b['spk']}) “{b['text'][:36]}”")
        elif not b["pred"] and truth:
            fn += 1
            wrong.append(f"    미탐 t={b['t']:6.1f}s ({a['spk']}→{b['spk']}) “{b['text'][:36]}”")
        else:
            tn += 1

    judged = tp + fp + fn + tn
    changes = tp + fn
    print(f"  채점 {judged}개 (겹침·무음으로 제외 {skipped}개)")
    if judged:
        prec = tp / (tp + fp) if (tp + fp) else float("nan")
        rec = tp / changes if changes else float("nan")
        print(f"  실제 전환 {changes}회 · 붙은 대시 {tp+fp}개 → 정밀도 {prec:.1%} · 재현율 {rec:.1%}")
        print(f"  오탐 {fp} · 미탐 {fn}")
        if verbose and wrong:
            print("\n".join(wrong[:15]))
    return {"clip": clip, "tp": tp, "fp": fp, "fn": fn, "tn": tn, "skipped": skipped}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="+", help="VoxConverse 클립 ID (예: crixb tiido)")
    ap.add_argument("--overlap-tol", type=float, default=0.5)
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    totals = defaultdict(int)
    for clip in a.clips:
        r = score_clip(clip, a.overlap_tol, a.verbose)
        for k in ("tp", "fp", "fn", "tn", "skipped"):
            totals[k] += r[k]

    tp, fp, fn, tn = totals["tp"], totals["fp"], totals["fn"], totals["tn"]
    judged = tp + fp + fn + tn
    changes = tp + fn
    if not judged:
        print("\n채점할 구간이 없습니다.")
        return 1
    prec = tp / (tp + fp) if (tp + fp) else float("nan")
    rec = tp / changes if changes else float("nan")
    acc = (tp + tn) / judged

    print("\n" + "=" * 58)
    print(f"합계 · 클립 {len(a.clips)}개 · 채점 {judged}개 (제외 {totals['skipped']}개)")
    print(f"  실제 화자 전환 {changes}회 · 붙은 대시 {tp+fp}개")
    print(f"  정밀도 {prec:.1%} · 재현율 {rec:.1%} · 정확도 {acc:.1%}")
    print(f"  오탐 {fp}개 · 미탐 {fn}개")
    print("=" * 58)
    print("\n보고서 문장:")
    print(f'  "공개 데이터셋 VoxConverse 의 2인 대화 {len(a.clips)}편에서 전 과정을 검증했다.'
          f' 자막 구간 {judged}개 중 실제 화자 전환 {changes}회를 기준으로 정밀도 {prec:.0%},'
          f' 재현율 {rec:.0%}였다 (오탐 {fp}회)."')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
