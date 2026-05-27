# 04. 개발 로드맵 (Vibe Coding Edition)

> 가장 빨리 *눈에 보이는 결과*에 도달하고, 그 위에서 반복적으로 개선하는 순서.

---

## 핵심 원칙: Thinnest Vertical Slice First

**나쁜 순서 (bottom-up):**
모든 백엔드를 완벽하게 만든 다음 마지막 주에 프론트를 붙임 → 끝까지 가지 못함, demo 못 함

**좋은 순서 (thinnest vertical slice):**
처음부터 *입력 → 출력*이 한 줄로 연결된 *가장 얇은* 전체 파이프라인을 만들고, 각 단계를 점점 *진짜로* 교체해나감

→ 매주 *작동하는 무언가*가 있다. 동기 유지에 절대 중요.

---

## Phase 0: Prerequisites (이번 주 — 4~6시간)

### 0.1 개발 환경 설정

**Python (백엔드)**
```bash
# 추천: Python 3.11 (PRAAT/Parselmouth와 가장 호환)
brew install python@3.11   # macOS

# 가상환경
cd ~/Projects
mkdir SoundShape && cd SoundShape
python3.11 -m venv venv
source venv/bin/activate

# 필수 패키지
pip install --upgrade pip
pip install parselmouth praat-parselmouth     # PRAAT
pip install openai-whisper faster-whisper      # ASR
pip install torch torchaudio                   # PyTorch
pip install transformers                       # HuggingFace (wav2vec2)
pip install silero-vad                         # 또는 torch.hub
pip install ffmpeg-python                      # FFmpeg wrapper
pip install fastapi uvicorn                    # API
pip install numpy scipy matplotlib librosa     # 분석 보조
pip install jupyter                            # 노트북

# requirements.txt 저장
pip freeze > requirements.txt
```

**FFmpeg 설치**
```bash
brew install ffmpeg   # macOS
# Windows: https://ffmpeg.org/download.html
```

**Node.js (프론트엔드)**
```bash
# Node 20 LTS 추천
brew install node

# Next.js 프로젝트 생성
npx create-next-app@latest frontend --typescript --tailwind --app
cd frontend
npm install d3 framer-motion
```

### 0.2 디렉토리 만들기

```bash
mkdir -p SoundShape/{backend/{api,pipeline,mapping,models,tests},data/{samples,timelines,datasets},docs,notebooks}
```

### 0.3 테스트용 음원 확보

ISEF·KCF demo 단계에서 쓸 다양한 톤의 짧은 음성 클립 5~10개:

- **RAVDESS 샘플 다운로드** (Zenodo, 무료): https://zenodo.org/record/1188976
  - 같은 문장을 8가지 감정으로 발화한 클립 → 매핑 검증에 최고
- **한국 드라마 명장면 5초 클립** (저작권 주의: 본인 발표용 한정)
- **자기 목소리로 직접 녹음**: "괜찮아"를 5가지 톤(진심/비꼼/슬픔/분노/체념)으로 녹음 → 발표용 demo의 hero piece

### 0.4 첫 번째 sanity check 노트북

`notebooks/00_sanity_check.ipynb`:

```python
import parselmouth
import whisper
from transformers import pipeline

# PRAAT 동작 확인
snd = parselmouth.Sound("data/samples/test.wav")
pitch = snd.to_pitch()
print(f"평균 피치: {pitch.get_value_at_time(snd.duration/2):.1f} Hz")

# Whisper 동작 확인
model = whisper.load_model("base")
result = model.transcribe("data/samples/test.wav")
print(f"전사: {result['text']}")

# wav2vec2 emotion 동작 확인
emo = pipeline("audio-classification",
               model="superb/wav2vec2-base-superb-er")
print(emo("data/samples/test.wav"))
```

**Phase 0 완료 조건:**
- [ ] Parselmouth가 피치를 추출함
- [ ] Whisper가 텍스트를 출력함
- [ ] wav2vec2가 감정 라벨을 출력함
- [ ] Next.js 앱이 `npm run dev`로 뜸

---

## Phase 1 (Week 1): Tiny Visual Win 🌟

> **목표:** *하드코딩한* 감정 데이터로 *움직이는 도형*을 화면에 띄움. 진짜 데이터는 다음 주.

### 왜 이게 먼저인가
프로젝트 첫 주에 *시각적 결과*를 보면 동기 폭발. "이게 진짜 되네!"의 순간이 빨라야 끝까지 간다.

### 할 일
1. Next.js 메인 페이지에 Canvas 컴포넌트 하나 추가
2. 하드코딩된 감정 시퀀스 정의:
   ```ts
   const fakeTimeline = [
     { t: 0, emotion: "sad", valence: -0.6, arousal: -0.3 },
     { t: 2, emotion: "angry", valence: -0.7, arousal: 0.8 },
     { t: 4, emotion: "joy", valence: 0.7, arousal: 0.6 },
   ];
   ```
3. `setInterval`로 t 진행하며 Canvas에 *모양 그리기*:
   - sad → 파란 흐르는 곡선
   - angry → 빨간 날카로운 별
   - joy → 노란 둥근 폭발
4. 화면 하단에 더미 자막 함께 표시

**Phase 1 완료 조건:**
- [ ] 화면에 감정 데이터에 따라 모양·색이 *애니메이션*되는 것이 보임
- [ ] 매핑 규칙이 함수로 분리되어 있음 (`mapEmotionToVisual(e)` 형태)

**결과물:** GIF/스크린샷 한 장 — *"SoundShape 첫 frame"*. 이걸 슬랙·블로그 어디든 자랑하기.

---

## Phase 2 (Week 2): PRAAT/Parselmouth POC

> **목표:** 음성 파일을 넣으면 *진짜 prosody feature*가 추출되고 그래프로 그려짐.

### 할 일
1. `backend/pipeline/prosody.py` 작성:
   ```python
   def extract_prosody(wav_path: str) -> dict:
       snd = parselmouth.Sound(wav_path)
       pitch = snd.to_pitch()
       intensity = snd.to_intensity()
       return {
           "f0_mean": call(pitch, "Get mean", 0, 0, "Hertz"),
           "f0_range": call(pitch, "Get standard deviation", 0, 0, "Hertz"),
           "intensity_mean": call(intensity, "Get mean", 0, 0, "energy"),
           "jitter": ...,
           "shimmer": ...,
           # 시간 별 곡선도 (이후 시각화용)
           "f0_curve": [...],
           "intensity_curve": [...],
       }
   ```
2. RAVDESS 8가지 감정 클립에 대해 prosody 추출
3. 결과를 matplotlib으로 시각화 — 각 감정별 feature 분포 확인
4. *예상 패턴이 나오는지 검증*: 분노는 F0/intensity 높음, 슬픔은 낮음 등

**Phase 2 완료 조건:**
- [ ] 한 줄 함수로 음성 → prosody dict 변환
- [ ] 8개 감정 × 여러 클립 시각화 그래프 (논문 figure 수준)
- [ ] *재후가 PRAAT 결과를 보고 무슨 의미인지 설명 가능*

---

## Phase 3 (Week 2~3): 감정 분류 모듈

> **목표:** 음성 파일 → 감정 카테고리 + valence/arousal 좌표.

### 할 일
1. `backend/pipeline/emotion.py`:
   ```python
   from transformers import pipeline
   
   classifier = pipeline("audio-classification", 
                         model="superb/wav2vec2-base-superb-er")
   
   def classify_emotion(wav_path: str) -> dict:
       result = classifier(wav_path)
       category = result[0]["label"]
       confidence = result[0]["score"]
       # category를 valence-arousal로 변환 (lookup table)
       v, a = CATEGORY_TO_VA[category]
       return {"category": category, "confidence": confidence,
               "valence": v, "arousal": a}
   ```
2. Dimensional 모델도 추가 (옵션):
   ```python
   model_dim = pipeline("audio-classification",
                        model="audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim")
   ```
3. RAVDESS 클립으로 정확도 측정 → 70% 이상 목표
4. 한국어 음성 데이터로도 테스트 (AIHub 감정 음성)

**Phase 3 완료 조건:**
- [ ] 한국어 + 영어 음성 모두에서 감정 분류 작동
- [ ] confusion matrix가 합리적 (분노↔공포 혼동 정도는 OK)

---

## Phase 4 (Week 3): Real Data → Visual

> **목표:** Phase 1의 *하드코딩 시각화*에 Phase 2~3의 *진짜 데이터*를 연결.

### 할 일
1. `backend/api/process.py` — FastAPI 엔드포인트:
   ```python
   @app.post("/process")
   async def process(file: UploadFile):
       wav = save_and_convert(file)
       segments = vad(wav)
       timeline = []
       for seg in segments:
           text = asr(seg)
           prosody = extract_prosody(seg)
           emotion = classify_emotion(seg)
           visual = map_emotion_to_visual(emotion, prosody)
           timeline.append({...})
       return {"timeline": timeline}
   ```
2. 프론트에서 API 호출, JSON 받음
3. Phase 1의 Canvas 컴포넌트가 *진짜 timeline*을 받아서 재생
4. 자막도 word-level timestamp로 동기화

**Phase 4 완료 조건:**
- [ ] *진짜 음성 파일* 업로드 → 처리 → 자막+시각화 재생 (가장 단순한 형태로)
- [ ] 첫 *end-to-end demo* 가능

### 🎉 마일스톤: MVP 완성
여기까지가 *KCF에 제출 가능한 최소 product*. 나머지는 polish.

---

## Phase 5 (Week 4): Cross-Modal Mapping 정교화

> **목표:** "임의로 골랐어요" → "연구 기반이에요"로 매핑 업그레이드.

### 할 일
1. `docs/mapping_rationale.md` 작성 — 각 매핑의 *근거 논문 인용*
2. `backend/mapping/` 모듈 분리:
   - `shape_rules.py` — Kiki/Bouba 기반
   - `color_rules.py` — Hupka et al. 1997 기반
   - `size_rules.py` — arousal 비례
   - `motion_rules.py` — jitter/shimmer 기반
3. 매핑 규칙을 JSON config로 외부화 → 실험·조정 쉬워짐
4. 시각화 A/B 테스트: 같은 음성에 매핑 v1 vs v2 비교

**Phase 5 완료 조건:**
- [ ] 모든 매핑 규칙이 *논문 인용*과 함께 문서화됨
- [ ] 매핑이 코드 안에 hard-code되지 않고 *수정 가능한 config*

---

## Phase 6 (Week 5): UI/UX Polish

> **목표:** 데모를 봤을 때 *"오 멋지다"* 가 자연스럽게 나오게.

### 할 일
1. 자막 위치·폰트·가독성 다듬기
2. 도형 애니메이션 부드럽게 (Framer Motion / D3 transition)
3. *감정 타임라인* 컴포넌트 추가 — 화면 하단에 영상 전체의 감정 흐름 시각화
4. 컨트롤 패널: 자막 ON/OFF, 시각화 ON/OFF, 매핑 v1/v2 토글
5. 다크모드 / 라이트모드
6. 로딩 상태·에러 처리

**Phase 6 완료 조건:**
- [ ] 처음 본 사람이 5초 안에 *무슨 도구인지* 이해함
- [ ] *5분짜리 demo video* 녹화 가능한 수준

---

## Phase 7 (Week 6): 실제 미디어로 검증

> **목표:** 인공 클립이 아닌 *실제 콘텐츠*로 작동시키기.

### 할 일
1. **드라마 클립**: "오징어게임", "이태원클라쓰", "기생충" 같은 명장면 — 감정 변화가 풍부한 5초~30초 짜리
2. **음악 클립**: 가사 있는 한국 가요 + 영어 팝송 — 노래 톤은 발화와 다르므로 별도 검증
3. **팟캐스트**: 차분한 톤 vs 격앙된 토론 비교
4. 각 카테고리에서 *작동 잘 됨* vs *부족함* 케이스 정리
5. 시각화 매핑 미세조정

**Phase 7 완료 조건:**
- [ ] 3개 카테고리(드라마/음악/팟캐스트) 각각의 best-case demo 클립 보유
- [ ] *심사위원에게 보여줄 hero clip* 3개 확정

---

## Phase 8 (Week 7): User Testing

> **목표:** 실제 사용자(특히 청각장애인) 피드백.

### 할 일
1. 가능하면 *한국농아인협회* 또는 *학교 내 청각장애 학생*과 컨택
2. 어렵다면: *눈 감고 듣지 않기* 실험 (정상 청각자에게 음 끄고 시각화만 보여줌)
3. 평가 지표:
   - 같은 영상의 *자막만* vs *자막+SoundShape* 시청 후 *감정 이해도* 측정
   - 시각 언어의 *직관성* 5점 척도
4. 피드백 기반 마지막 조정

**Phase 8 완료 조건:**
- [ ] 최소 5명에게 testing 완료
- [ ] *정량적 결과* 보유 (점수·비교)
- [ ] ISEF 발표용 *user impact narrative* 확보

---

## Phase 9 (Week 8): 제출 자료

> **목표:** KCF 제출 + ISEF 대비 자료.

### 할 일
1. **Demo video** (3~5분):
   - 문제 소개 → SoundShape 보여주기 → 작동 원리 → user testing 결과
2. **GitHub README**: 잘 정리된 프로젝트 페이지
3. **기술 보고서** (KCF 제출용)
4. **포스터 / 발표 슬라이드**
5. **Research write-up** (ISEF 대비, 영문)

**Phase 9 완료 조건:**
- [ ] KCF 제출 완료
- [ ] ISEF 대비 자료까지 한 세트 완료

---

## 주차별 마일스톤 요약

| Week | 마일스톤 | "이게 되면 동기 폭발" |
|---|---|---|
| 0 | Prerequisites | 환경 세팅 |
| 1 | Hardcoded visual moving | 🌟 *첫 시각화* |
| 2 | PRAAT 분석 결과 | 음성에서 진짜 feature 나옴 |
| 2~3 | Emotion classifier | 음성→감정 라벨 |
| 3 | End-to-end MVP | 🎉 *진짜 음성 업로드 → 시각화* |
| 4 | Research-grounded mapping | 매핑에 근거 |
| 5 | UI polish | 데모가 "예쁘다" |
| 6 | Real media | 드라마·노래에서 작동 |
| 7 | User testing | 실제 임팩트 데이터 |
| 8 | Submission | 제출 완료 |

---

## Vibe Coding 팁

1. **매주 화면 녹화 1개 남기기** — 진척이 눈에 보임. 동기 부스터.
2. **Phase 4 (MVP)에 도달 못하면 위험 신호** — Phase 5 이후는 *polish*다. *작동하는 것*이 *예쁜 것*보다 먼저.
3. **하드코딩 두려워하지 말기** — Phase 1처럼 *가짜 데이터*로 먼저 *모양*을 만들어두면 그 다음이 쉽다.
4. **모듈 분리 엄격히** — VAD 교체하고 싶을 때 다른 코드가 안 부서져야 한다. 함수의 입출력만 깔끔히.
5. **JSON timeline을 황금 산출물로** — 백엔드 처리 결과는 *항상 JSON 파일로 저장*해두기. 같은 음원 재처리 안 해도 되고, 매핑만 바꿔서 다른 결과 만들 수도 있다.
6. **GitHub commit 매일** — Phase별 브랜치 + main에 머지. 발표 때 *commit history 자체*가 작업의 증거가 됨.
7. **막히면 Phase를 건너뛰지 말고 *얇게 만들고 다음 Phase 진입*** — 예: Phase 3에서 한국어 모델 못 찾으면 일단 영어로만 진행. 나중에 돌아옴.

---

## 위험 신호 & 대처

| 위험 | 대처 |
|---|---|
| Phase 2에서 PRAAT 결과가 이상함 | 음성 정규화 (16kHz mono, -3dB 정규화) 후 재시도 |
| Phase 3에서 한국어 감정 모델 정확도 낮음 | 다국어 모델 또는 AIHub 데이터로 fine-tune |
| Phase 4에서 동기화 어긋남 | Word-level timestamp + 50ms window로 보정 |
| Phase 5에서 매핑이 어색함 | 청각장애인 user testing을 Phase 5와 병행 |
| Phase 7에서 user testing 어려움 | 정상 청각자에게 "소리 끄고 보기" 실험으로 대체 가능 |

---

## 첫 30분에 할 것

지금 이 문서를 다 읽고 다음 30분 안에 할 일:

1. (10분) Python 3.11 가상환경 만들고 `pip install parselmouth openai-whisper`
2. (5분) FFmpeg 설치 확인 (`ffmpeg -version`)
3. (10분) `notebooks/00_sanity_check.ipynb` 만들어서 위의 sanity check 코드 실행
4. (5분) 잘 안 되면 에러 메시지 메모해두고 다음 세션에 같이 풀기

**여기서부터가 진짜 시작입니다.**
