# SoundShape

청각장애인을 위한 *감정 시각화 캡션* 시스템.
음성의 prosody(운율) 특성을 실시간으로 추출해 모양·색·크기·움직임으로 변환하여 영상·음악 위에 함께 표시한다.

---

## 한 줄 소개

> 청각장애인이 영화·드라마·음악을 볼 때, 자막은 *말의 내용*만 알려준다. SoundShape는 자막이 놓치는 *말의 톤과 감정*을 **시각적 도형 언어**로 함께 보여준다.

---

## 문제 의식

청각장애인의 *실용적* 접근성 문제(시각 알람, 자막 등)는 상당 부분 해결되었다. 그러나 *문화적·감정적* 접근성은 여전히 큰 공백이다.

같은 "괜찮아"라는 한 단어도 목소리의 톤에 따라 의미가 완전히 달라진다:
- 진심으로 안심시키는 "괜찮아"
- 비꼬는 "괜찮아"
- 슬픔을 누르는 "괜찮아"
- 화를 참는 "괜찮아"

기존 자막은 이 차이를 전달하지 못한다. 청각장애인은 영화의 *대사*는 읽지만 *연기*는 절반밖에 경험하지 못한다.

SoundShape는 이 공백을 메운다.

---

## 핵심 아이디어

1. **음성 신호처리** — Parselmouth/PRAAT으로 음성에서 prosodic feature(피치, 강도, 떨림, 속도 등)를 추출
2. **감정 모델링** — 추출된 feature를 valence(긍정-부정) × arousal(차분-격앙) 2차원 감정 공간에 매핑 + Ekman 6 categorical emotion 분류
3. **Cross-modal mapping** — 감정 좌표를 도형(shape) · 색(color) · 크기(size) · 움직임(motion)으로 변환. 매핑 규칙은 임의가 아니라 cross-modal correspondence 연구 기반
4. **실시간 렌더링** — 자막 옆/위에 도형이 함께 흐름

---

## 입력 / 출력

**입력**
- 음악 (MP3, WAV)
- 영상 (MP4, 드라마/영화 클립)
- 팟캐스트, 라이브 스트리밍

**출력**
- 텍스트 자막(기존과 동일)
- *그 위에 동기화된 감정 시각화 도형*
- 시간축 위에서 감정의 변화를 그래픽으로 추적

---

## 문서 구조

| 파일 | 내용 |
|---|---|
| `00_README.md` | 본 문서. 프로젝트 진입점 |
| `01_DIFFERENTIATION.md` | 기존 솔루션과 비교, 차별화 포인트 |
| `02_TECHSTACK.md` | 사용하는 기술·알고리즘·라이브러리·논문 |
| `03_ARCHITECTURE.md` | 시스템 아키텍처 다이어그램 + 데이터 플로우 |
| `04_ROADMAP.md` | 개발 로드맵 (prerequisites 포함, vibe coding 순서) |

---

## 목표 대회

- **1차: 한국코드페어 (KCF) SW공모전** — 작동하는 product demo
- **2차: ISEF 대표 선발** — Linguistics × Accessibility × HCI 융합 research narrative

---

## 슬로건 (proposed)

> "Captions tell you *what* was said. SoundShape shows you *how*."
