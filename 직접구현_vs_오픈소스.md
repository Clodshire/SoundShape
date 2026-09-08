# 직접 구현 vs 오픈소스 활용 구분표

> 목적: "Whisper·wav2vec2도 남의 것 아니냐"는 질문에 정면으로 답한다.
> 핵심 논리: **기성 모델은 '원자재'다. SoundShape의 작품성은 그 원자재를 연구 근거·비꼼 보존·바이트 일치·실시간이 되는 하나의 시스템으로 엮은 설계·로직에 있다.**
> 아래 B열의 모든 항목은 저장소에 실제 코드로 존재한다(파일 경로 명시).

---

## A. 기성 오픈소스 자산 — 그대로 가져다 쓴 것

| 자산 | 역할 | 우리가 한 것은 "호출"뿐 |
|---|---|---|
| OpenAI Whisper (faster-whisper, large-v3-turbo) | 음성 → 자막·타임스탬프 | 모델 로드·추론 |
| wav2vec2 (audeering MSP-dim / superb-ER) | 음성 → 감정 임베딩(차원형·범주형) | 임베딩 추출 |
| XLSR-korean (kresnik) | 한국어 특화 음성 임베딩 | 임베딩 추출 |
| Parselmouth / PRAAT | 운율 특징(F0·지터·시머 등) 추출 | 특징 계산 |
| scikit-learn | SVM·PCA·교차검증 | 표준 API 호출 |
| FFmpeg | 오디오 16kHz 표준화 | 포맷 변환 |
| yt-dlp | 유튜브 URL 인제스트 | 다운로드 |
| FastAPI / Next.js / React / TypeScript | 서버·웹 프레임워크 | 표준 사용 |
| WebGL (브라우저 API) | GPU 렌더링 기반 | API 사용 |

→ 이들은 **각각 "라벨 하나" 또는 "숫자 하나"**를 뱉을 뿐, 그 자체로는 감정을 눈에 보이게 하지 못한다.

---

## B. 직접 설계·구현 — SoundShape 고유 (모두 실제 코드로 존재)

| # | 구성요소 | 무엇을 직접 만들었나 | 왜 독창적인가 | 코드 위치 |
|---|---|---|---|---|
| 1 | **하이브리드 감정 결정 로직** | 범주형 라벨과 차원형(V/A) 좌표를 결합해 최종 감정을 정하는 규칙. 범주형이 못 잡는 슬픔을 V/A로 복원, 분노↔공포를 우월성으로 분리 | 기성 모델 어느 하나도 이 결정을 안 해준다. 두 모델의 약점을 서로 메우는 로직이 핵심 | `backend/pipeline/emotion.py` (`derive_category`) |
| 2 | **차원형 모델 편향 보정** | 차원형 모델의 계통적 편향을 데이터 기반으로 보정(calibration) | 원본 모델은 편향된 값을 그대로 준다. 보정으로 정확도 상승(55→55%대 개선의 일부) | `backend/pipeline/emotion.py` |
| 3 | **텍스트 융합 tie-breaker** | 음향 정서가가 **불확실할 때만** 자막 단어의 감성을 참고. 확신 있는 부정 톤(비꼼)은 절대 안 덮음 | 이게 SoundShape의 비꼼 보존 장치. 단위 테스트로 검증(`fuse_valence(-0.55, "wonderful") == -0.55`) | `backend/pipeline/emotion.py` (`fuse_valence`), `text_sentiment.py` |
| 4 | **언어별 임베딩 라우팅 + 검증** | 한국어는 XLSR-korean으로 라우팅. ablation·임베딩 교체·McNemar 검정으로 채택 근거 확보(43.6→49.6%, p<0.001) | 모델을 "고른 것"이 아니라 **실험으로 입증해 선택**. 다국어 무튜닝 30.7% 대조군까지 설계 | `scripts/ablation_korean.py`, `embedding_swap_ko.py` |
| 5 | **감정→시각 매핑 엔진 + 단일 config** | 감정 벡터를 도형·색·크기·움직임으로 번역하는 규칙 엔진. 규칙을 하나의 config로 외부화 | 백엔드(Python)·프론트(TS)가 **같은 규칙을 읽고 출력 바이트 일치를 자동 검증** — 드리프트 원천 차단 | `backend/mapping/engine.py`, `frontend/src/lib/mapping.ts`, `config/mapping_config.json` |
| 6 | **운율 변조** | 측정된 지터·시머·발화속도를 시각의 떨림·크기·움직임 속도에 직접 연결 | 같은 감정이라도 목소리 떨림이 크면 더 떨리게 보임 — 기성 모델엔 없는 표현 계층 | `backend/mapping/engine.py`, `mapping_config.json` (prosody_modulation) |
| 7 | **WebGL 감정 필드 셰이더** | 프랙탈 노이즈로 에너지 필드를 만들고 감정별 실루엣·색·움직임을 프래그먼트 셰이더로 렌더 | 직접 작성한 GLSL 셰이더. 감정 파라미터를 실시간 시각으로 변환 | `frontend/src/lib/emotionField.ts` (FRAG/VERT) |
| 8 | **2D 폴백 렌더러** | WebGL 컨텍스트 소실 시 별도 캔버스에 색상 글로우로 대체 렌더 | GPU 실패(macOS ANGLE 컨텍스트 소실)에도 데모가 죽지 않는 강건성 | `frontend/src/lib/emotionField.ts` (`start2DFallback`) |
| 9 | **스트리밍 파이프라인** | 첫 구간만 먼저 처리해 ~6초 만에 재생 시작, 이후 재생보다 앞서 처리(룩어헤드) + 버퍼 헬스 게이팅 | "실시간처럼" 보이게 하는 재생 엔진. 프리버퍼·언더런 가드 직접 설계 | `backend/pipeline/streaming.py`, `frontend/src/app/page.tsx` (Clock B) |
| 10 | **침묵 기준 청킹** | 무음 구간 기준으로 발화 단위 분할 | 발화 단위 감정·자막 동기화의 전제 | `backend/pipeline/chunker.py` |
| 11 | **크롬 확장 SPA 처리** | 유튜브가 페이지 리로드 없이 영상만 바꾸는 구조를 videoId 감시로 감지 → 이전 분석 취소(AbortController)·오버레이 정리·새 영상 재분석 | 발견한 실제 버그를 구조적으로 수정. 이벤트+폴링 이중 감지 | `extension/src/content.ts` |
| 12 | **불확실성 중립화** | 모델 확신이 낮으면 채도·크기·움직임을 낮춰 감정을 "덜 주장" | 틀린 감정을 확신 있게 보여주지 않는 안전 설계 | `backend/pipeline/emotion.py`, `frontend/src/lib/mapping.ts` (`applyConfidence`) |
| 13 | **스크립트 모드 (.srt)** | 사용자가 자막+감정 태그를 직접 넣어 재생(모델 우회) | 발표·데모에서 원하는 감정을 통제 | `frontend/src/lib/scriptMode.ts`, `page.tsx` |
| 14 | **실험·재현성 하네스** | 고정 seed·fold로 ablation/임베딩 교체를 공정 비교. 스크립트·결과 파일 보존 | 43.6% 정확 재현, 조건 간 차이=특징 구성뿐으로 통제 | `scripts/eval_korean.py`, `ablation_korean.py`, `embedding_swap_ko.py` |
| 15 | **자동화 테스트 23개** | 매핑 정확성·감정/운율 로직·실패 케이스(무음·손상) 검증 | 안정성 축 입증(충돌 0건) | `backend/tests/` (pytest) |

---

## C. 한 줄 요약 (발표·Q&A용)

> "기성 모델은 **원자재**입니다. Whisper는 글자를, wav2vec2는 임베딩을, PRAAT는 숫자를 줄 뿐입니다.
> 저희가 만든 것은 그 원자재를 **① 연구 근거 매핑, ② 비꼼을 보존하는 융합 로직, ③ 백엔드·프론트 바이트 일치, ④ 실시간 스트리밍, ⑤ GPU 실패에도 죽지 않는 렌더링**으로 엮은 시스템 전체입니다.
> 부품은 누구나 쓸 수 있지만, '무엇을 왜 어떻게 연결하는가'가 작품입니다."

## D. 활용법

- **설명서**: Ⅱ장(작품 제작) 뒤에 부록으로 삽입하거나, Ⅰ-3.5 차별점을 이 표로 뒷받침.
- **발표 슬라이드**: A/B 두 열을 나란히 놓은 한 장 → "남의 것 vs 우리 것"이 한눈에.
- **Q&A**: 질문 H6("다 남의 모델인데 만든 게 뭔가")의 근거 자료. B열에서 **1·3·5·7·9번**을 대표로 대면 충분.

> 주의(정직성): 위 항목들은 **설계·로직·통합이 이 작품의 것**이라는 의미다. 라이브러리를 쓴 것 자체를 숨기지 말고, "라이브러리 위에 무엇을 얹었나"로 답하는 것이 심사에서 가장 강하다.
