"""하이브리드 vs AI 전용 차이가 가장 큰 순간을 찾는다 — 포스터 그림용.

    python scripts/find_hybrid_contrast.py [입력.wav] [--lang ko|en]

두 모드가 거의 같아 보이는 지점에서 비교 그림을 찍으면 그림이 아무 말도 하지
못한다. 이 스크립트는 실제로 눈에 띄게 갈리는 구간을 골라 준다.

백엔드(localhost:8000)가 켜져 있어야 한다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.mapping.engine import map_emotion_to_visual  # noqa: E402

API = "http://localhost:8000/process/stream"


def visual_gap(seg: dict) -> tuple[float, dict]:
    """두 모드의 시각 파라미터 차이. 실제로 보이는 채널만 센다."""
    emotion = seg.get("emotion") or {}
    prosody = seg.get("prosody")
    reference = seg.get("reference")
    if not prosody:
        return 0.0, {}

    ai = map_emotion_to_visual(emotion, prosody, reference, mode="full_ai")
    hy = map_emotion_to_visual(emotion, prosody, reference, mode="hybrid")

    d_size = abs(hy["size"] - ai["size"])
    d_sat = abs(hy["color"]["s"] - ai["color"]["s"]) / 100.0
    d_amp = abs(hy["motion"]["amplitude"] - ai["motion"]["amplitude"])
    d_spd = abs(hy["motion"]["speed"] - ai["motion"]["speed"])

    # 크기가 가장 눈에 띄고, 그 다음이 채도다. 속도는 정지 화면에서 안 보인다.
    score = d_size * 2.0 + d_sat * 1.2 + d_amp * 0.8 + d_spd * 0.2
    return score, {
        "size": (round(ai["size"], 3), round(hy["size"], 3)),
        "sat": (round(ai["color"]["s"]), round(hy["color"]["s"])),
        "amp": (round(ai["motion"]["amplitude"], 3), round(hy["motion"]["amplitude"], 3)),
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = Path(args[0] if args else "data/samples/long3.wav")
    lang = "ko"
    if "--lang" in sys.argv:
        lang = sys.argv[sys.argv.index("--lang") + 1]

    if not src.exists():
        print(f"입력 파일이 없습니다: {src}")
        return 1

    print(f"분석 중… {src.name}  (백엔드가 켜져 있어야 합니다)")
    try:
        resp = requests.post(
            API, files={"file": src.open("rb")}, data={"language": lang},
            stream=True, timeout=600,
        )
        resp.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        print(f"백엔드에 연결하지 못했습니다: {exc}")
        return 1

    rows = []
    for raw in resp.iter_lines():
        if not raw:
            continue
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("data:"):
            line = line[5:].strip()
        try:
            seg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "emotion" not in seg or not seg.get("prosody"):
            continue
        score, detail = visual_gap(seg)
        rows.append((score, seg.get("t", 0.0), seg.get("emotion", {}), seg.get("text", ""), detail))

    if not rows:
        print("운율이 붙은 구간이 없습니다.")
        return 1

    rows.sort(reverse=True)
    print(f"\n구간 {len(rows)}개 · 차이가 큰 순서\n")
    print(f"{'시각':>7}  {'감정':<10} {'확신':>5}  {'차이':>6}  크기(AI→하이브리드)  채도")
    print("─" * 78)
    for score, t, emo, text, d in rows[:10]:
        conf = emo.get("category_confidence")
        conf_s = f"{conf:.2f}" if conf is not None else "  — "
        print(
            f"{t:7.2f}  {emo.get('category',''):<10} {conf_s:>5}  {score:6.3f}  "
            f"{d['size'][0]:.2f} → {d['size'][1]:.2f}        {d['sat'][0]}% → {d['sat'][1]}%"
        )
        if text:
            print(f"{'':>7}  \"{text.strip()[:58]}\"")

    best = rows[0]
    print(f"\n★ 여기서 찍으세요:  t = {best[1]:.1f}초   ({best[2].get('category')})")
    print("  타임라인에서 그 지점을 클릭한 뒤 SS.compare() 를 실행하면 됩니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
