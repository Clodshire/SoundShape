"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DemoCard } from "./DemoCard";
import styles from "./site.module.css";
import { TONES, TONE_ORDER } from "./tones";
import { Waveform } from "./Waveform";

// The public SoundShape site — the confirmed design mockup, wired to the real
// backend through <DemoCard>. The research/debug view lives at /studio.
export function SoundShapeSite({ fontClass }: { fontClass: string }) {
  return (
    <div className={`${styles.site} ${fontClass}`}>
      <header className={styles.header}>
        <span className={styles.logo}>SoundShape</span>
        <nav className={styles.nav} aria-label="주요 메뉴">
          <a href="#features" className={styles.navLink}>
            기능
          </a>
          <a href="#how" className={styles.navLink}>
            사용법
          </a>
          <a href="#demo" className={styles.navCta}>
            지금 체험하기
          </a>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>청각장애인을 위한 감정 자막</span>
          <h1 className={styles.h1}>
            말투가 들리지 않아도,
            <br />
            감정은 보이게
          </h1>
          <p className={styles.lead}>
            같은 말도 위로가 되기도, 비꼼이 되기도 해요. SoundShape는 자막에 색과
            움직임을 더해 목소리에 담긴 말투까지 보여드립니다.
          </p>
        </section>

        <DemoCard />

        <section id="features" className={styles.features}>
          <div className={styles.sectionHead}>
            <h2 className={styles.h2}>SoundShape가 하는 일</h2>
            <p className={styles.sub}>자막만으로는 전해지지 않던 것들을 보여드려요.</p>
          </div>
          <div className={styles.featureGrid}>
            <div className={styles.feature}>
              <div className={styles.dotRow}>
                {(["comfort", "anger", "sarcasm"] as const).map((id) => (
                  <span key={id} aria-hidden="true" className={styles.featureDot} style={{ background: TONES[id].color }} />
                ))}
              </div>
              <h3 className={styles.featureTitle}>한눈에 보이는 색 안내</h3>
              <p className={styles.featureText}>
                색이 무슨 감정인지, 화면 어디서든 바로 확인할 수 있어요. 따로 찾아볼
                필요가 없어요.
              </p>
            </div>
            <div className={`${styles.feature} ${styles.featureAccent}`}>
              <span aria-hidden="true" className={styles.featureDot} style={{ background: "#D0402A" }} />
              <h3 className={styles.featureTitle}>내 눈에 맞춤 설정</h3>
              <p className={styles.featureTextDark}>
                사람마다 잘 보이는 색과 움직임이 달라요. 5분이면 나에게 맞게 조정돼요.
              </p>
              <Link href="/studio" className={styles.btnAccent}>
                맞춤 설정 시작하기
              </Link>
            </div>
            <div className={styles.feature}>
              <span aria-hidden="true" className={styles.featureDot} style={{ background: "#FF0000" }} />
              <div className={styles.featureTitleRow}>
                <h3 className={styles.featureTitle}>유튜브에서 바로</h3>
                <span className={styles.chip}>Chrome 확장</span>
              </div>
              <p className={styles.featureText}>
                설치 한 번이면 유튜브를 보면서 바로 감정이 보여요. 다운로드도, 업로드도
                필요 없어요.
              </p>
            </div>
            <div className={styles.feature}>
              <span aria-hidden="true" className={styles.featureDot} style={{ background: "#6A6A75" }} />
              <h3 className={styles.featureTitle}>어떤 영상 파일이든</h3>
              <p className={styles.featureText}>
                유튜브가 아니어도 괜찮아요. 드라마, 강의, 통화 녹화까지 파일을 올리면
                똑같이 분석해요.
              </p>
            </div>
          </div>
        </section>

        <YouTubePreview />

        <section id="how" className={styles.how}>
          <h2 className={styles.h2}>이렇게 작동해요</h2>
          <ol className={styles.steps}>
            {[
              ["영상을 올리거나 유튜브를 켜세요", "파일을 올리거나, 유튜브에서 확장 프로그램을 켜요."],
              ["목소리 톤을 분석해요", "말의 높낮이와 세기에서 감정을 읽어내요."],
              ["자막에 색이 더해져요", "글자는 그대로, 색과 움직임만 더해져 말투가 보여요."],
            ].map(([title, text], i) => (
              <li key={title} className={styles.step}>
                <span aria-hidden="true" className={styles.stepNum}>
                  {i + 1}
                </span>
                <h3 className={styles.stepTitle}>{title}</h3>
                <p className={styles.featureText}>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.cta}>
          <h2 className={styles.h2Small}>지금 바로 체험해보세요</h2>
          <a href="#demo" className={styles.btnDarkLg}>
            데모 체험하기
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerLogo}>SoundShape</span>
        <p className={styles.footerText}>
          베타로 운영 중인 서비스이며, 사용자 의견을 반영해 계속 발전하고 있습니다.
        </p>
        <p className={styles.footerText}>
          <Link href="/studio">연구용 분석 화면</Link>
        </p>
      </footer>
    </div>
  );
}

// Illustration of the extension on a YouTube page. Decorative motion only —
// it cycles the four tones so visitors see what the overlay looks like.
function YouTubePreview() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % TONE_ORDER.length), 3400);
    return () => window.clearInterval(id);
  }, []);
  const tone = TONES[TONE_ORDER[i]];

  return (
    <section className={styles.preview}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2Small}>유튜브에서는 이렇게 보여요</h2>
        <p className={styles.sub}>
          확장 프로그램을 켜면 탭을 옮기지 않아도, 보고 있는 화면 위에 바로 나타나요.
        </p>
      </div>
      <div className={styles.browser}>
        <div className={styles.browserBar}>
          <span aria-hidden="true" className={styles.light} style={{ background: "#e5605a" }} />
          <span aria-hidden="true" className={styles.light} style={{ background: "#e6b95a" }} />
          <span aria-hidden="true" className={styles.light} style={{ background: "#61c454" }} />
          <div className={styles.urlBar}>youtube.com/watch?v=…</div>
        </div>
        <div className={styles.fakeVideo}>
          <div
            aria-hidden="true"
            className={styles.previewGlow}
            style={{ backgroundColor: tone.color, animationDuration: `${tone.speed}s` }}
          />
          <div className={styles.overlayTag}>
            <span className={styles.dot} style={{ backgroundColor: tone.color }} />
            <span>AI가 읽은 감정 · {tone.label}</span>
          </div>
          <div className={styles.overlayLine}>
            <div className={styles.overlayWave}>
              <Waveform tone={tone} analyser={null} speaking playing />
            </div>
            <span className={styles.overlayCaption}>&ldquo;괜찮아...&rdquo;</span>
          </div>
          <div className={styles.onBadge}>
            <span aria-hidden="true" className={styles.dot} style={{ background: "#D0402A" }} />
            SoundShape 켜짐
          </div>
        </div>
      </div>
    </section>
  );
}
