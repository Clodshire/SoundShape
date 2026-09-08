"""각성/정서가 산점도 — 포스터용 한글판.

    python scripts/poster/make_va_scatter_ko.py

`docs/eval/va_points_actors12.json` (RAVDESS actors 01,02 · n=120, 원본
va_scatter.png와 동일한 재현 데이터: valence r=0.422 · arousal r=0.732)을
읽어 한글 범례가 붙은 포스터용 그림을 그린다.

이전 판(Claude Design이 만든 scatter_poster.svg)은 x축 라벨이 그래프
테두리와 겹쳤다. 원인은 라벨을 축 바로 아래 여백 없이 붙인 것 — 여기서는
xlabel을 축과 분리된 자리로 내리고, 상관계수는 라벨이 아니라 부제로 뺐다.
"""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager

REPO = Path(__file__).resolve().parent.parent.parent
SRC = REPO / "docs/eval/va_points.json"
OUT = REPO / "figures/va_scatter_ko.png"

# 한글이 네모로 깨지지 않게, 설치된 것 중 첫 번째를 쓴다.
_avail = {f.name for f in font_manager.fontManager.ttflist}
for cand in ("Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", "Nanum Gothic", "AppleGothic"):
    if cand in _avail:
        plt.rcParams["font.family"] = cand
        break
plt.rcParams["axes.unicode_minus"] = False

# (한글 라벨, 영어 원표기, 색) — RAVDESS 8클래스, 포스터 팔레트와 맞춤.
CATS = [
    ("중립", "neutral", "#9a9a9a"),
    ("평온", "calm", "#7fb8b3"),
    ("기쁨", "happy", "#f0c84e"),
    ("슬픔", "sad", "#5b84b1"),
    ("분노", "angry", "#d9534f"),
    ("두려움", "fearful", "#8a6fc4"),
    ("혐오", "disgust", "#5fa863"),
    ("놀람", "surprised", "#f0a25c"),
]


def main() -> int:
    if not SRC.exists():
        print(f"입력 데이터가 없습니다: {SRC}")
        print("먼저 만드세요:  python scripts/evaluate.py --actors 01 02")
        return 1

    # docs/eval/va_points.json 은 emotion/valence/arousal 만 담는다 — 정답 V/A는
    # evaluate.py 와 같은 Russell 목표값 표를 여기서도 그대로 써서 상관계수를 낸다.
    TARGET_VA = {
        "neutral": (0.0, 0.0), "calm": (0.35, -0.45), "happy": (0.7, 0.5),
        "sad": (-0.65, -0.4), "angry": (-0.6, 0.65), "fearful": (-0.5, 0.6),
        "disgust": (-0.5, 0.35), "surprised": (0.45, 0.65),
    }
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    v = np.array([r["valence"] for r in rows])
    a = np.array([r["arousal"] for r in rows])
    tv = np.array([TARGET_VA[r["emotion"]][0] for r in rows])
    ta = np.array([TARGET_VA[r["emotion"]][1] for r in rows])
    v_r = float(np.corrcoef(v, tv)[0, 1])
    a_r = float(np.corrcoef(a, ta)[0, 1])

    fig, ax = plt.subplots(figsize=(6.4, 6.4))
    fig.patch.set_facecolor("white")

    for _, en, color in CATS:
        idx = [i for i, r in enumerate(rows) if r["emotion"] == en]
        if not idx:
            continue
        ax.scatter(v[idx], a[idx], s=95, c=color, alpha=0.72,
                   edgecolor="white", linewidth=0.8, zorder=3)

    ax.axhline(0, color="#c8c8c8", lw=1, zorder=1)
    ax.axvline(0, color="#c8c8c8", lw=1, zorder=1)
    ax.set_xlim(-1.02, 1.02)
    ax.set_ylim(-1.02, 1.02)
    ax.set_xticks([-1, 0, 1])
    ax.set_yticks([-1, 0, 1])
    ax.tick_params(labelsize=13)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color("#333333")

    # 원래 시안은 "정서가 r=0.42" / "각성도 r=0.73" 을 축 라벨 한 줄에 같이
    # 넣는 디자인이었다. 겹침의 원인은 그 자체가 아니라 축 아래·왼쪽 여백이
    # 라벨 한 줄 높이보다 좁았던 것 — 라벨은 그대로 두고 labelpad와
    # subplots_adjust 여백을 라벨이 실제로 필요한 만큼 넉넉히 잡는다.
    ax.set_xlabel(f"정서가 (valence)   r = {v_r:.2f}", fontsize=16, fontweight=800,
                   color="#1c1c1f", labelpad=12)
    ax.set_ylabel(f"각성도 (arousal)   r = {a_r:.2f}", fontsize=16, fontweight=800,
                   color="#2f7a4f", labelpad=16)

    fig.subplots_adjust(left=0.16, right=0.60, top=0.95, bottom=0.19)

    # 범례: 그림 오른쪽에 2열 텍스트 범례 (matplotlib legend()가 아니라 직접 배치 —
    # 포스터 시안처럼 큰 점 + 큰 글자로 두 칸에 나눠 앉힌다).
    col1 = CATS[:4]
    col2 = CATS[4:]
    y0, dy = 0.86, 0.20
    for i, (ko, en, color) in enumerate(col1):
        y = y0 - i * dy
        fig.patches.append(plt.Circle((0.655, y), 0.018, transform=fig.transFigure,
                                        color=color, clip_on=False))
        fig.text(0.685, y, ko, fontsize=17, va="center", color="#1c1c1f")
    for i, (ko, en, color) in enumerate(col2):
        y = y0 - i * dy
        fig.patches.append(plt.Circle((0.845, y), 0.018, transform=fig.transFigure,
                                        color=color, clip_on=False))
        fig.text(0.875, y, ko, fontsize=17, va="center", color="#1c1c1f")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT, dpi=220, facecolor="white")
    print(f"저장됨: {OUT}  ({OUT.stat().st_size // 1024} KB)")
    print(f"  n={len(rows)} · valence r={v_r:.3f} · arousal r={a_r:.3f}  (RAVDESS actors 01,02)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
