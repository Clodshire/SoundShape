# 02. 기술 스택 (Tech Stack)

> 각 레이어가 *무엇*을 하며 *왜* 그 도구를 선택했는지, *어떤 학술적 근거*가 있는지.

---

## 전체 스택 한눈에

| 레이어 | 도구/기술 | 역할 |
|---|---|---|
| **0. 미디어 입출력** | FFmpeg | 비디오/오디오 디코딩·추출 |
| **1. 음성 구간 분리** | Silero VAD | 침묵 vs 발화 구간 자동 검출 |
| **2. 음성 인식 (ASR)** | OpenAI Whisper | 음성을 텍스트 자막으로 |
| **3. Prosody 추출** | Parselmouth (PRAAT) | 피치·강도·jitter·shimmer 등 |
| **4. 감정 분류** | wav2vec2 fine-tuned (HuggingFace) | 음성에서 감정 카테고리·차원 추출 |
| **5. 감정 표현 공간** | Russell Circumplex (valence × arousal) | 2D 연속 감정 공간 |
| **6. Cross-modal 매핑** | 자체 규칙 엔진 (연구 기반) | 감정 → 시각 파라미터 |
| **7. 렌더링** | React + Canvas API + D3.js | 동적 도형 그리기 |
| **8. 동기화** | Web Audio API + 타임스탬프 | 영상-음성-시각 sync |
| **9. UI 셸** | Next.js + TailwindCSS | 웹앱 |
| **10. 배포** | Vercel (웹) / Chrome Extension Manifest V3 | 배포 |

---

## 레이어 0: 미디어 입출력 — FFmpeg

### 무엇을 하는가
사용자가 업로드한 MP4/MKV 영상에서 *오디오 트랙*을 분리하고, MP3·WAV로 정규화한다.

### 왜 FFmpeg인가
- 사실상 모든 코덱·컨테이너 지원
- 명령줄에서 한 줄로 호출 가능
- Python wrapper(`ffmpeg-python`)와 JS wrapper(`fluent-ffmpeg`) 모두 성숙

### 사용 예시
```bash
ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 output.wav
```
(비디오 제외, 16kHz mono PCM WAV로 추출 — ASR과 PRAAT에 모두 적합)

---

## 레이어 1: 음성 구간 분리 — Silero VAD

### 무엇을 하는가
**VAD = Voice Activity Detection.** 오디오에서 *사람이 말하고 있는 구간*과 *침묵·배경음* 구간을 자동으로 나눈다.

### 왜 필요한가
영화 한 편을 통째로 PRAAT에 넣으면 무의미한 침묵·배경음까지 분석된다. *발화 단위로 자르고* 각 발화별 prosody를 분석해야 의미가 있다.

### 왜 Silero인가
- 매우 가볍다 (~1MB 모델, CPU만으로 실시간)
- 다국어 지원 (한국어 포함)
- PyTorch hub에서 한 줄로 로드
- 오픈소스 (MIT 라이선스)

### 대안
- `webrtcvad` — 더 가볍지만 정확도 낮음
- `pyannote-audio` — 더 정확하지만 무거움

---

## 레이어 2: 음성 인식 (ASR) — OpenAI Whisper

### 무엇을 하는가
음성을 텍스트로 변환 (기본 자막 생성). 시간축 정보(start/end timestamp)도 함께 출력.

### 왜 Whisper인가
- 다국어 (한국어·영어 동시 처리)
- *Word-level timestamps* 제공 → SoundShape의 시각 동기화에 필수
- 오픈소스, 무료
- 음악·드라마처럼 *잡음·음악 섞인 음성*에서도 견고

### 모델 선택
| 모델 | 크기 | 속도 | 정확도 |
|---|---|---|---|
| `whisper-base` | 74MB | 매우 빠름 | 보통 |
| `whisper-small` | 244MB | 빠름 | 좋음 |
| **`whisper-large-v3-turbo`** | 809MB | 적당 | **최고** ⭐ |
| `whisper-large-v3` | 1.5GB | 느림 | 최고 |

**선택: `whisper-large-v3-turbo`** — 속도-정확도 균형 최적.

### 더 빠른 옵션
- `faster-whisper` (CTranslate2 기반, 4배 빠름)
- `whisper.cpp` (C++ 포팅, 모바일·CPU에서 더 빠름)

---

## 레이어 3: Prosody 추출 — Parselmouth (PRAAT)

### 무엇을 하는가
음성 신호에서 다음 **prosodic feature**들을 추출:

| Feature | 정의 | 감정 관련성 |
|---|---|---|
| **F0 (Pitch)** | 기본 주파수 (목소리 높낮이) | 분노·기쁨 = 높음, 슬픔·차분 = 낮음 |
| **F0 range** | 발화 내 피치 변동폭 | 격앙 = 큼, 단조로움 = 작음 |
| **Intensity** | 음량 (dB) | 분노 = 큼, 슬픔 = 작음 |
| **Jitter** | 피치 주기 간 미세 변동 | 떨림·긴장 |
| **Shimmer** | 음량 간 미세 변동 | 떨림·노화·감정 |
| **HNR** | Harmonics-to-Noise Ratio | 목소리 청명도 |
| **Speech rate** | 초당 음절 수 | 흥분 = 빠름, 슬픔 = 느림 |
| **Pause ratio** | 발화 대비 침묵 비율 | 망설임·생각 |
| **Formants (F1, F2, F3)** | 모음 공명 주파수 | 발음 명료도 |

### 왜 PRAAT인가
- **음성학·언어학의 사실상 표준 도구** (Boersma & Weenink, 1992-)
- 학술적 신뢰성 압도적 (수천 편의 논문에서 사용)
- 100가지 이상의 음성 측정 함수 내장

### 왜 Parselmouth인가
PRAAT은 GUI 도구지만 **Parselmouth는 PRAAT의 Python 바인딩**이다. Python 코드 안에서 PRAAT의 모든 기능을 호출할 수 있다.

```python
import parselmouth
snd = parselmouth.Sound("clip.wav")
pitch = snd.to_pitch()
intensity = snd.to_intensity()
formants = snd.to_formant_burg()
# 모든 PRAAT 기능 사용 가능
```

### 핵심 참고 문헌
- Boersma, P. (2001). "PRAAT, a system for doing phonetics by computer". *Glot International* 5(9/10).
- Jadoul et al. (2018). "Introducing Parselmouth: A Python interface to PRAAT". *Journal of Phonetics* 71.

---

## 레이어 4: 감정 분류 — wav2vec 2.0 Fine-tuned

### 무엇을 하는가
음성 신호 자체에서 *감정*을 추정. Layer 3의 PRAAT feature들과 *상호 보완적*이다 (PRAAT은 *해석 가능한 feature*, wav2vec2는 *심층 representation*).

### 왜 wav2vec 2.0인가
- Facebook AI Research가 발표한 음성 표현 학습 모델 (Baevski et al., 2020)
- *Self-supervised* 학습되어 음성의 풍부한 representation을 가짐
- Fine-tuning으로 감정 분류에 빠르게 적응 가능
- HuggingFace에 **이미 감정 분류용 fine-tuned 체크포인트** 다수 공개

### 사용할 사전학습 모델
| 모델 | 학습 데이터 | 언어 |
|---|---|---|
| `superb/wav2vec2-large-superb-er` | IEMOCAP | 영어 |
| `audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim` | MSP-Podcast | 영어 (valence-arousal-dominance 차원) |
| `j-hartmann/emotion-english-distilroberta-base` | 다양한 텍스트 | 영어 텍스트용 (보조) |
| **한국어 감정 음성**: AIHub 감정 음성 dataset으로 fine-tune | KESS, AIHub | 한국어 |

### 두 출력 모두 사용
- **Categorical**: Ekman 6 emotion (happy, sad, angry, fear, disgust, surprise) + neutral
- **Dimensional**: Valence (-1 ~ +1) × Arousal (-1 ~ +1)

---

## 레이어 5: 감정 표현 공간 — Russell Circumplex Model

### 무엇인가
Russell (1980)이 제안한 **2차원 감정 공간 모델**.

- **Valence** (X축): 부정 ↔ 긍정
- **Arousal** (Y축): 차분 ↔ 격앙

이 평면 위에 모든 감정이 좌표로 표현 가능:

```
              Arousal +
                 |
   분노 (-V,+A)  |  흥분 (+V,+A)
                 |
   ─────────────┼──────────────  Valence
                 |
   슬픔 (-V,-A)  |  평온 (+V,-A)
                 |
              Arousal -
```

### 왜 이 모델인가
- 단순 카테고리(분노/슬픔/기쁨)는 *경계가 있지만* 실제 감정은 *연속적·혼합적*
- "*차분한 슬픔*" vs "*격앙된 슬픔*"의 차이를 표현 가능
- *시각화에 자연스럽게 매핑* (2D 평면)

### 핵심 참고 문헌
- Russell, J. A. (1980). "A circumplex model of affect". *Journal of Personality and Social Psychology* 39(6).
- Mehrabian, A. (1996). "Pleasure-arousal-dominance: A general framework" (3D 확장)

---

## 레이어 6: Cross-Modal Mapping Engine ⭐ (핵심 차별화)

### 무엇을 하는가
감정 좌표 (valence, arousal, category) → 시각 파라미터 (shape, color, size, motion).

### 매핑 규칙 (연구 기반)

#### Shape (모양)
- **Kiki/Bouba effect** (Köhler 1929; Ramachandran & Hubbard 2001):
  - 날카로운/각진 모양 ↔ 날카로운 소리·고각성 부정 감정 (분노)
  - 둥근/부드러운 모양 ↔ 부드러운 소리·저각성 긍정 감정 (평온, 슬픔)

| 감정 카테고리 | 모양 |
|---|---|
| Anger | 날카로운 삼각형, jagged star |
| Joy | 부드러운 원, 폭발형 꽃잎 |
| Sadness | 흐르는 물결, 늘어진 타원 |
| Fear | 떨리는 가시 |
| Surprise | 폭발하는 별 |
| Neutral | 단순 원 |

#### Color (색)
- **Hupka et al. (1997)** — 색-감정 cross-cultural 매핑:
  - 분노 = 빨강 (강함, 6개 문화권 공통)
  - 슬픔 = 검정/회색 (강함, 공통)
  - 기쁨 = 노랑/주황 (강함, 공통)
  - 공포 = 검정 (보통)
- **HSL 모델 사용**:
  - Hue (색조) = Valence (부정=빨/검, 긍정=노/초)
  - Saturation = Arousal (격앙=채도 높음, 차분=낮음)
  - Lightness = Categorical adjustment

#### Size (크기)
- **Arousal에 비례**
- 작은 도형 = 차분, 큰 도형 = 격앙
- 시각적으로 직관적

#### Motion (움직임)
- **Stability에 반비례**:
  - jitter, shimmer 높음 → 떨림·흔들림 애니메이션
  - 안정적 prosody → 정적이거나 부드러운 흐름
- 추가:
  - 빠른 발화 → 빠른 움직임
  - 느린 발화 → 느린 움직임

### 핵심 참고 문헌
- Hupka, R. B. et al. (1997). "The colors of anger, envy, fear, and jealousy: A cross-cultural study". *Journal of Cross-Cultural Psychology* 28(2).
- Spence, C. (2011). "Crossmodal correspondences: A tutorial review". *Attention, Perception, & Psychophysics* 73(4).
- Ramachandran, V. S. & Hubbard, E. M. (2001). "Synaesthesia—A window into perception, thought and language". *Journal of Consciousness Studies*.
- Schubert, E. (2004). "Modeling perceived emotion with continuous musical features". *Music Perception*.

---

## 레이어 7: 렌더링 — React + Canvas API + D3.js

### 무엇을 하는가
매핑 엔진이 출력한 시각 파라미터를 *동적 그래픽*으로 화면에 그린다.

### 왜 이 조합인가

**React (UI 셸)**
- 컴포넌트 기반, 상태 관리 깔끔
- 자막 표시, 컨트롤 패널 등 UI는 모두 React로

**Canvas API (그래픽)**
- 픽셀 단위 그리기 → 자유로운 도형·애니메이션
- 60fps 가능
- WebGL보다 단순, 도형 수준에 적합

**D3.js (데이터-구동 애니메이션)**
- *데이터(감정 좌표)*가 변할 때 *그래픽이 자연스럽게 전이*하도록 만들기 쉬움
- `d3.transition()`, `d3.interpolate()` 등으로 부드러운 보간

**Framer Motion (UI 애니메이션)**
- React 컴포넌트의 자연스러운 등장·퇴장

### 대안 검토
- **Three.js**: 3D 가능하지만 overkill
- **p5.js**: creative coding에 좋지만 React 통합이 번거로움
- **SVG**: 도형 수 많아지면 성능 저하

---

## 레이어 8: 동기화 — Web Audio API + 타임스탬프

### 무엇을 하는가
영상·자막·시각 도형의 **시간축 정합** (sync).

### 어떻게
1. Whisper가 word-level timestamps 출력
2. Parselmouth로 발화 단위의 prosody window 추출 (예: 50ms 단위)
3. Mapping engine이 각 window를 시각 파라미터로 변환
4. 영상 재생 시 `currentTime`을 기준으로 *현재 window의 파라미터*를 렌더링

### Web Audio API의 역할
- 영상 플레이어와 별도로 *오디오 컨텍스트*를 만들어 실시간 분석 가능
- 정확한 시간 동기화

---

## 레이어 9: UI 셸 — Next.js + TailwindCSS

### 왜 Next.js인가
- React 기반 풀스택 프레임워크
- 파일 시스템 기반 라우팅 (단순)
- API routes로 백엔드 통합
- Vercel 배포 한 줄

### 왜 TailwindCSS인가
- 빠른 UI 개발
- 디자인 일관성

---

## 레이어 10: 배포

### Phase 1: 웹 앱 (Next.js + Vercel)
- 사용자가 음성/영상 파일 업로드
- 처리 후 결과 확인

### Phase 2: Chrome Extension (Manifest V3)
- YouTube·Netflix 위에 실시간 오버레이
- *진짜 실용성* 단계

### Phase 3 (옵션): Electron 데스크톱 앱
- 로컬 영상 파일 처리

---

## 데이터셋

학습·평가에 사용할 공개 dataset:

| 데이터셋 | 언어 | 크기 | 용도 |
|---|---|---|---|
| **RAVDESS** | 영어 | 7,356 클립 | 영화 톤 감정 음성, 8가지 감정 |
| **IEMOCAP** | 영어 | 12시간 | 대화 기반, valence-arousal 라벨 |
| **CREMA-D** | 영어 | 7,442 클립 | 6 감정, 다양한 화자 |
| **MSP-Podcast** | 영어 | 100시간+ | 자연스러운 팟캐스트, dimensional 라벨 |
| **AIHub 감정 음성** | 한국어 | 대규모 | 한국어 감정 음성 (정부 공개) |
| **KESDy18** | 한국어 | 7시간 | KAIST 한국어 감정 음성 |
| **CMU-MOSEI** | 영어 | 23,500 발화 | 멀티모달 (음성+텍스트+영상) |

---

## 핵심 참고 논문 정리

### 음성-감정 인식
1. Baevski et al. (2020). "wav2vec 2.0: A framework for self-supervised learning of speech representations". *NeurIPS*.
2. Pepino et al. (2021). "Emotion recognition from speech using wav2vec 2.0 embeddings". *Interspeech*.
3. Wagner et al. (2023). "Dawn of the transformer era in speech emotion recognition". *IEEE TASLP*.

### Prosody와 감정
4. Banse, R. & Scherer, K. R. (1996). "Acoustic profiles in vocal emotion expression". *Journal of Personality and Social Psychology*.
5. Juslin, P. N. & Laukka, P. (2003). "Communication of emotions in vocal expression and music performance". *Psychological Bulletin*.

### Cross-modal Correspondence
6. Spence, C. (2011). "Crossmodal correspondences: A tutorial review". *Attention, Perception, & Psychophysics*.
7. Hupka, R. B. et al. (1997). "The colors of anger, envy, fear, and jealousy". *Journal of Cross-Cultural Psychology*.
8. Ramachandran, V. S. & Hubbard, E. M. (2001). "Synaesthesia—A window into perception, thought and language". *Journal of Consciousness Studies*.

### 접근성·자막 연구
9. Vy, Q. V. & Fels, D. I. (2010). "Using avatars for improving speaker identification in captioning". *INTERACT*.
10. Rashid et al. (2008). "Expressing emotions using animated text captions". *ICCHP*.
11. Lee, Y. J. et al. (CHI 2024). "Vibrant captions for the deaf and hard of hearing".

### 감정 모델
12. Russell, J. A. (1980). "A circumplex model of affect". *JPSP*.
13. Ekman, P. (1992). "An argument for basic emotions". *Cognition & Emotion*.

### PRAAT / Parselmouth
14. Boersma, P. (2001). "PRAAT, a system for doing phonetics by computer". *Glot International*.
15. Jadoul, Y., Thompson, B., & de Boer, B. (2018). "Introducing Parselmouth: A Python interface to PRAAT". *Journal of Phonetics*.

---

## 요약

| 질문 | 답 |
|---|---|
| "어떻게 음성에서 감정을 잡아요?" | wav2vec2 (deep) + Parselmouth/PRAAT (interpretable) 듀얼 분석 |
| "어떻게 감정을 표현해요?" | Russell Circumplex 2D + Ekman categorical 하이브리드 |
| "시각화는 어떻게 만들어요?" | Cross-modal correspondence 연구에 기반한 4채널(shape/color/size/motion) 매핑 + React/Canvas |
| "이게 학술적으로 정당해요?" | 본 문서의 15개 참고 논문이 매핑·feature·모델 선택의 근거 |
