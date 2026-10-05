"""응답지 격자를 responses_deaf.csv 로 바꾼다.

입력 형식 (docs/userstudy/응답_입력.txt):

    # OFF            ← 자막만 (조건 A)
    D01  S A H F H N S A A S F N
    D02  ...
    # ON             ← 자막 + SoundShape (조건 B)
    D01  ...

한 줄 = 참가자 1명, 12개 값 = 1~12번 구간.
코드: H 기쁨 · A 화남 · F 공포 · S 슬픔 · N 감정없음 · ? 모름
"""
from __future__ import annotations
import csv, sys
from pathlib import Path

CODE = {"H": "happy", "A": "angry", "F": "afraid", "S": "sad",
        "N": "neutral", "?": "unknown"}
REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "docs" / "userstudy" / "응답_입력.txt"
OUT = REPO / "docs" / "userstudy" / "responses_deaf.csv"


def main() -> int:
    if not SRC.exists():
        print(f"{SRC} 가 없습니다."); return 1
    cond, rows, bad = None, [], []
    for ln, line in enumerate(SRC.read_text(encoding="utf-8").splitlines(), 1):
        t = line.strip()
        if not t:
            continue
        if t.startswith("#"):
            u = t.lstrip("#").strip().upper()
            cond = "A" if u.startswith("OFF") else "B" if u.startswith("ON") else None
            if cond is None:
                bad.append(f"{ln}행: '# OFF' 또는 '# ON' 이어야 합니다 — {t}")
            continue
        parts = t.split()
        pid, vals = parts[0], parts[1:]
        if cond is None:
            bad.append(f"{ln}행: 조건 표시(# OFF / # ON) 앞에 데이터가 있습니다"); continue
        if len(vals) != 12:
            bad.append(f"{ln}행: {pid} 값이 {len(vals)}개입니다 (12개여야 합니다)"); continue
        for i, v in enumerate(vals, 1):
            key = v.upper()
            if key not in CODE:
                bad.append(f"{ln}행: {pid} {i}번 값 '{v}' 을 모르겠습니다"); continue
            rows.append({"participant_id": pid, "form": "", "clip_id": str(i),
                         "condition": cond, "chosen_emotion": CODE[key],
                         "tone": "", "confidence": ""})
    if bad:
        print("⚠️ 문제:"); [print("  " + b) for b in bad]
        if not rows: return 1
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["participant_id", "form", "clip_id",
                                          "condition", "chosen_emotion", "tone", "confidence"])
        w.writeheader(); w.writerows(rows)
    a = sum(r["condition"] == "A" for r in rows)
    print(f"{OUT} 저장 — 총 {len(rows)}개 (자막만 {a} · SoundShape {len(rows)-a})")
    print(f"참가자 {len({r['participant_id'] for r in rows})}명")
    return 0


if __name__ == "__main__":
    sys.exit(main())
