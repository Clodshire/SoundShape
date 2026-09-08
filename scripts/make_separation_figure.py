"""포스터 기능① 그림 — 원본(음악+대사) vs 분리된 음성 파형 비교.

    python scripts/make_separation_figure.py [입력.wav] [출력.png]

기본 입력은 data/samples/music_test.wav, 기본 출력은 figures/그림4_음원분리.png.

두 트랙을 같은 세로 축으로 그린다. 축을 따로 잡으면 분리 후 조용해진 것이
'파형이 작아진' 것으로 보이지 않고 그림이 거짓말을 하게 된다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

# 한글 라벨이 네모로 깨지지 않도록. 설치된 것 중 첫 번째를 쓴다.
_available = {f.name for f in font_manager.fontManager.ttflist}
for _candidate in ("Apple SD Gothic Neo", "Pretendard", "Malgun Gothic",
                   "Nanum Gothic", "AppleGothic", "Noto Sans CJK KR"):
    if _candidate in _available:
        plt.rcParams["font.family"] = _candidate
        break
plt.rcParams["axes.unicode_minus"] = False
import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.pipeline import audio_io, separation  # noqa: E402

INK = "#1a1a1f"
MUTED = "#8a8a95"
ACCENT = "#d9534f"   # 원본 — 강조색
GREEN = "#3f9e57"    # 분리된 음성 — "측정값" 계열


def envelope(x: np.ndarray, sr: int, points: int = 1600) -> np.ndarray:
    """구간별 최대 절댓값. 파형을 축소해도 피크가 살아 있게."""
    n = max(1, len(x) // points)
    trimmed = x[: (len(x) // n) * n].reshape(-1, n)
    return np.abs(trimmed).max(axis=1)


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "data/samples/music_test.wav")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "figures/그림4_음원분리.png")

    if not src.exists():
        print(f"입력 파일이 없습니다: {src}")
        return 1

    if not separation.is_enabled():
        print("음원 분리가 꺼져 있습니다. config/separation_config.json 의 enabled 를 확인하세요.")
        return 1

    # 분리 모델은 44.1kHz 스테레오만 받는다. 샘플이 16kHz면 여기서 변환한다.
    prepared = audio_io.extract_for_separation(src)
    if prepared.sample_rate != sf.info(str(src)).samplerate:
        print(f"44.1kHz 스테레오로 변환: {prepared.path.name}")

    print(f"분리 중… {src.name}  (모델 로딩 포함 수십 초 걸립니다)")
    result = separation.separate_file(prepared.path)
    if result is None:
        print("분리 결과가 없습니다.")
        return 1
    if result.skipped:
        print(
            f"이 파일은 음악 에너지 비율 {result.music_energy_ratio:.3f} 으로 "
            "임계값 미만이라 분리를 건너뛰었습니다. 음악이 더 큰 파일을 쓰세요."
        )
        return 1

    mixture, sr = sf.read(str(prepared.path), dtype="float32", always_2d=True)
    mixture = mixture.mean(axis=1)

    env_mix = envelope(mixture, sr)
    env_voc = envelope(result.vocals, result.sample_rate)
    span = min(len(env_mix), len(env_voc))
    env_mix, env_voc = env_mix[:span], env_voc[:span]
    t = np.linspace(0, len(mixture) / sr, span)
    ymax = float(max(env_mix.max(), env_voc.max())) * 1.12

    fig, axes = plt.subplots(2, 1, figsize=(9, 4.6), sharex=True, sharey=True)
    fig.patch.set_facecolor("white")

    panels = [
        (axes[0], env_mix, ACCENT, "원본 — 대사 + 배경음악",
         f"음악 에너지 비율 {result.music_energy_ratio:.3f}"),
        (axes[1], env_voc, GREEN, "분리 후 — 음성 트랙만",
         "이 트랙만 운율·감정 분석에 사용"),
    ]
    for ax, env, color, title, note in panels:
        ax.fill_between(t, env, -env, color=color, linewidth=0)
        ax.set_ylim(-ymax, ymax)
        ax.set_yticks([])
        ax.set_title(title, loc="left", fontsize=12, color=INK, pad=8)
        ax.text(0.995, 0.86, note, transform=ax.transAxes, ha="right",
                fontsize=9.5, color=MUTED)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color("#d5d5dc")
        ax.tick_params(colors=MUTED, labelsize=9)

    axes[1].set_xlabel("시간 (초)", fontsize=10, color=MUTED)
    fig.tight_layout()

    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=200, facecolor="white")
    print(f"저장됨: {out}  ({out.stat().st_size // 1024} KB)")
    print(f"  음악 에너지 비율 {result.music_energy_ratio:.3f} · 길이 {result.duration:.1f}초")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
