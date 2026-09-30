import styles from "./site.module.css";

// "기술 검증" — the numbers behind the demo. Every figure here comes from the
// student's own evaluation files (docs/eval/*.json, poster/SoundShape_논문초안.md);
// keep them in sync if the evaluation is rerun.

const REPO_URL = "https://github.com/Clodshire/SoundShape";

const PIPELINE: { n: string; title: string; detail: string; done: boolean }[] = [
  { n: "①", title: "음원 분리", detail: "HDemucs", done: true },
  { n: "②", title: "감정 인식", detail: "wav2vec2 · PRAAT", done: true },
  { n: "③", title: "화자 전환", detail: "ECAPA-TDNN", done: true },
  { n: "④", title: "하이브리드 렌더링", detail: "측정값 + AI 판단", done: true },
  { n: "⑤", title: "개인 캘리브레이션", detail: "수집 중", done: false },
  { n: "⑥", title: "저확신 학습 루프", detail: "라벨 0건", done: false },
  { n: "⑦", title: "햅틱 채널", detail: "미구현", done: false },
];

const METRICS: { label: string; value: string; note: string; basis: string }[] = [
  {
    label: "English 4지 분류",
    value: "79.8%",
    note: "우연 25%",
    basis: "RAVDESS · GroupKFold 화자 독립 검증 · 배우 8인 · 클립 480개",
  },
  {
    label: "Korean 7지 분류",
    value: "49.6%",
    note: "우연 14.3% · 인간 평가자 상한 51.5%의 96.3%",
    basis: "AIHub · 층화 5겹 교차검증 · 클립 1,750개 (화자 정보 없음 — 화자 독립 아님)",
  },
  {
    label: "화자 전환 감지",
    value: "AUC 0.958",
    note: "모듈 단위",
    basis: "RAVDESS 발화 4,000쌍 기준",
  },
];

const STACK = [
  "HDemucs",
  "Whisper",
  "Parselmouth (PRAAT)",
  "wav2vec2-large-robust",
  "XLSR-korean",
  "ECAPA-TDNN",
  "scikit-learn SVM",
  "FastAPI",
  "Next.js",
  "Chrome Extension (MV3)",
];

export function TechProof() {
  return (
    <section id="proof" className={styles.proof} aria-labelledby="proof-title">
      <div className={styles.proofInner}>
        <span className={styles.proofEyebrow}>기술 검증</span>

        {/* 1. Headline — full-system user study */}
        <div className={styles.proofHero}>
          <h2 id="proof-title" className={styles.proofTitle}>
            자막만 볼 때보다, 감정이 두 배 넘게 읽혔어요
          </h2>
          <div className={styles.proofStats}>
            <div className={styles.proofStat}>
              <span className={styles.proofStatLabel}>전체 감정 인식 정확도</span>
              <span className={styles.proofBig}>
                <span className={styles.proofFrom}>27%</span>
                <span aria-hidden="true" className={styles.proofArrow}>→</span>
                <span className="sr-only"> 에서 </span>
                <span className={styles.proofTo}>73%</span>
              </span>
            </div>
            <div className={styles.proofStat}>
              <span className={styles.proofStatLabel}>비꼼·억눌린 감정 클립</span>
              <span className={styles.proofBig}>
                <span className={styles.proofFrom}>0%</span>
                <span aria-hidden="true" className={styles.proofArrow}>→</span>
                <span className="sr-only"> 에서 </span>
                <span className={styles.proofTo}>67%</span>
              </span>
              <span className={styles.proofStatNote}>
                자막만으로는 아무도 읽지 못했지만, SoundShape를 더하자 다수가 정답을 맞혔어요.
              </span>
            </div>
          </div>
          <p className={styles.proofMeta}>
            <span className={styles.proofMetaAccent}>+46%p</span>
            <span aria-hidden="true">·</span>
            <span>p = 0.016</span>
            <span aria-hidden="true">·</span>
            <span>n = 6, 대응표본 t검정</span>
            <span aria-hidden="true">·</span>
            <span>소리를 끈 상태, 자막만 vs 자막 + SoundShape</span>
          </p>
        </div>

        {/* 2. Pipeline */}
        <div className={styles.proofBlock}>
          <h3 className={styles.proofH3}>7단계 파이프라인</h3>
          <ol className={styles.pipeline}>
            {PIPELINE.map((s, i) => (
              <li key={s.n} className={styles.pipeItem}>
                <div className={s.done ? styles.pipeBox : styles.pipeBoxTodo}>
                  <span className={styles.pipeNum}>{s.n}</span>
                  <span className={styles.pipeTitle}>{s.title}</span>
                  <span className={styles.pipeDetail}>{s.detail}</span>
                  {!s.done && <span className={styles.pipeTag}>미완성</span>}
                </div>
                {i < PIPELINE.length - 1 && (
                  <span aria-hidden="true" className={styles.pipeArrow}>
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* 3. Accuracy */}
        <div className={styles.proofBlock}>
          <h3 className={styles.proofH3}>정확도</h3>
          <div className={styles.metricGrid}>
            {METRICS.map((m) => (
              <div key={m.label} className={styles.metric}>
                <span className={styles.metricLabel}>{m.label}</span>
                <span className={styles.metricValue}>{m.value}</span>
                <span className={styles.metricNote}>{m.note}</span>
                <span className={styles.metricBasis}>{m.basis}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Stack */}
        <div className={styles.proofBlock}>
          <h3 className={styles.proofH3}>기술 스택</h3>
          <ul className={styles.stack}>
            {STACK.map((t) => (
              <li key={t} className={styles.stackBadge}>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* 5. Honest limits */}
        <div className={styles.limits} role="note">
          <h3 className={styles.limitsTitle}>아직 검증되지 않은 것</h3>
          <ul className={styles.limitsList}>
            <li>
              <strong>개인 캘리브레이션</strong>과 <strong>저확신 학습 루프</strong>는 기능은
              만들었지만, 아직 참가자·라벨 데이터가 0건이라 효과를 측정하지 못했어요.
            </li>
            <li>
              <strong>햅틱 채널</strong>은 부품만 확보한 상태로, 아직 구현하지 않았어요.
            </li>
            <li>
              <strong>화자 전환 감지</strong>는 모듈 단위로만 검증했어요(AUC 0.958). 자막과
              결합한 전체 파이프라인에서는 아직 검증하지 못해 기본값은 꺼져 있어요.
            </li>
            <li>
              <strong>한국어 정확도</strong>는 화자 정보가 없는 데이터로 측정해, 같은 화자가
              학습과 평가에 겹쳤을 수 있어요. 실제 성능은 이보다 낮을 수 있어요.
            </li>
          </ul>
        </div>

        {/* 6. Repo */}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={styles.repoBtn}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
          </svg>
          GitHub에서 코드 보기
        </a>
      </div>
    </section>
  );
}
