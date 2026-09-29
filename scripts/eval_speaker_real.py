"""실제 2인 대화 클립으로 화자 전환 대시를 채점한다.

`eval_speaker.py` 가 RAVDESS 로는 답할 수 없다고 결론 낸 바로 그 질문을,
사람이 라벨을 매긴 진짜 대화로 답하기 위한 스크립트다. 정답을 기계가 아는
방법이 없으므로 두 단계로 나눈다.

  1) 준비 — 클립을 파이프라인에 태우고, 구간별로 "대시를 붙였는가"를 적은
     CSV 를 만든다. `화자` 칸은 비워 둔다.

         python scripts/eval_speaker_real.py prepare <URL 또는 파일> -o clip1.csv

  2) 채점 — 사람이 `화자` 칸을 A/B 로 채운 뒤:

         python scripts/eval_speaker_real.py score clip1.csv

정답은 "앞 구간과 화자가 달라졌는가" 로만 환산한다. 이 기능이 주장하는 것이
딱 그것이기 때문이다 — 누가 말하는지가 아니라, 바뀌었는지.

첫 구간은 비교 대상이 없어 예측도 정답도 없다. 채점에서 제외된다.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parent.parent
API = "http://localhost:8000"


def _segments(source: str) -> list[dict]:
    """파이프라인을 돌려 구간 목록을 받는다. URL 이면 URL 경로로, 아니면 업로드."""
    is_url = source.startswith("http://") or source.startswith("https://")
    if is_url:
        resp = requests.post(
            f"{API}/process/stream/url", data={"url": source, "language": ""},
            stream=True, timeout=1800,
        )
    else:
        path = Path(source)
        if not path.exists():
            sys.exit(f"파일이 없습니다: {path}")
        resp = requests.post(
            f"{API}/process/stream", files={"file": path.open("rb")},
            data={"language": ""}, stream=True, timeout=1800,
        )
    resp.raise_for_status()

    out = []
    for raw in resp.iter_lines():
        if not raw:
            continue
        line = raw.decode("utf-8", "replace").strip().removeprefix("data:").strip()
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "text" not in o:
            continue
        out.append(o)
    return out


def _mmss(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def prepare(source: str, out: Path) -> int:
    print(f"분석 중… {source}\n(유튜브 URL 이면 내려받기 + 분석이라 몇 분 걸립니다)")
    segs = _segments(source)
    if not segs:
        sys.exit("구간이 하나도 나오지 않았습니다.")

    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["구간", "시작", "끝", "자막", "예측대시", "화자"])
        for i, s in enumerate(segs):
            t = float(s.get("t", 0.0))
            d = float(s.get("duration", 0.0))
            w.writerow([
                i + 1, _mmss(t), _mmss(t + d),
                (s.get("text") or "").strip(),
                "대시" if s.get("speaker_changed") else "",
                "",  # 사람이 채울 칸
            ])

    n_dash = sum(1 for s in segs if s.get("speaker_changed"))
    print(f"\n저장됨: {out}")
    print(f"  구간 {len(segs)}개 · 대시 {n_dash}개")
    print("\n다음: `화자` 칸을 A / B 로 채운 뒤")
    print(f"  python scripts/eval_speaker_real.py score {out}")
    return 0


def score(path: Path) -> int:
    if not path.exists():
        sys.exit(f"파일이 없습니다: {path}")
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    if not rows:
        sys.exit("빈 파일입니다.")

    missing = [r["구간"] for r in rows if not (r.get("화자") or "").strip()]
    if missing:
        sys.exit(f"`화자` 칸이 비어 있는 구간: {', '.join(missing)}")

    spk = [(r.get("화자") or "").strip().upper() for r in rows]
    pred = [bool((r.get("예측대시") or "").strip()) for r in rows]
    text = [r.get("자막", "") for r in rows]

    tp = fp = fn = tn = 0
    wrong: list[str] = []
    # 첫 구간은 비교 대상이 없어 제외한다.
    for i in range(1, len(rows)):
        truth = spk[i] != spk[i - 1]
        p = pred[i]
        if p and truth:
            tp += 1
        elif p and not truth:
            fp += 1
            wrong.append(f"  오탐 · 구간 {i+1} ({spk[i-1]}→{spk[i]}) “{text[i][:32]}”")
        elif not p and truth:
            fn += 1
            wrong.append(f"  미탐 · 구간 {i+1} ({spk[i-1]}→{spk[i]}) “{text[i][:32]}”")
        else:
            tn += 1

    judged = tp + fp + fn + tn
    changes = tp + fn
    prec = tp / (tp + fp) if (tp + fp) else float("nan")
    rec = tp / changes if changes else float("nan")
    acc = (tp + tn) / judged if judged else float("nan")

    print(f"\n{path.name}")
    print(f"  구간 {len(rows)}개 · 채점 대상 {judged}개 (첫 구간 제외)")
    print(f"  실제 화자 전환 {changes}회 · 붙은 대시 {tp + fp}개")
    print()
    print(f"  정밀도  {prec:.1%}   (붙인 대시 중 맞은 비율 — 틀리면 없는 정보를 만들어냄)")
    print(f"  재현율  {rec:.1%}   (실제 전환 중 잡은 비율 — 놓치면 현상 유지)")
    print(f"  정확도  {acc:.1%}")
    print(f"  오탐 {fp}개 · 미탐 {fn}개")
    if wrong:
        print("\n틀린 곳:")
        print("\n".join(wrong))
    print("\n보고서 문장 예시:")
    print(f'  "실제 2인 대화 {len(rows)}구간에서 화자 전환 {changes}회 중 {tp}회를 잡았고,'
          f' 오탐은 {fp}회였다 (정밀도 {prec:.0%}, 재현율 {rec:.0%})."')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare", help="클립을 분석해 채점용 CSV 를 만든다")
    p.add_argument("source", help="유튜브 URL 또는 오디오/영상 파일 경로")
    p.add_argument("-o", "--out", type=Path, default=Path("results/speaker_real.csv"))
    s = sub.add_parser("score", help="사람이 채운 CSV 를 채점한다")
    s.add_argument("csv", type=Path)
    a = ap.parse_args()

    if a.cmd == "prepare":
        a.out.parent.mkdir(parents=True, exist_ok=True)
        return prepare(a.source, a.out)
    return score(a.csv)


if __name__ == "__main__":
    raise SystemExit(main())
