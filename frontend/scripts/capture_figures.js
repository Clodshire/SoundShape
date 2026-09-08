/*
 * 보고서용 그림 캡처 도구 — 브라우저 콘솔 전용
 *
 * 사용법
 *   1. http://localhost:3000 에서 음성 파일을 분석한다 (데모도 가능).
 *   2. Chrome 개발자 도구 → Console 을 연다.
 *   3. 이 파일 내용을 통째로 붙여넣고 Enter.
 *   4. SS.compare()  ← 하이브리드 vs AI 전용 비교 그림
 *      SS.grid()     ← 감정별 파형 격자 그림
 *   PNG 가 자동으로 다운로드된다.
 *
 * 캔버스를 여러 개 동시에 띄우면 이 맥북에서 색이 죽기 때문에,
 * 화면의 캔버스 하나를 상태만 바꿔가며 반복 촬영하는 방식이다.
 */
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = () => document.querySelector("canvas");
  const media = () => document.querySelector("audio, video");

  const buttonByText = (needle) =>
    [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").replace(/\s+/g, "").includes(needle.replace(/\s+/g, "")),
    );

  // WebGL 컨텍스트는 preserveDrawingBuffer 없이 만들어지므로, 렌더 루프 바깥에서
  // drawImage / toDataURL 로 읽으면 빈 이미지가 나온다 (그때는 이미 화면에 합성되고
  // 버퍼가 비워진 뒤다). 렌더러가 그리기 직후에 복사해 주는 capture() 를 쓴다.
  const snap = async () => {
    const el = canvas();
    const field = el && el.__ssField;
    if (!field) throw new Error("렌더러를 찾지 못했습니다. 분석이 끝난 뒤에 실행하세요.");
    if (field.renderer !== "webgl") {
      throw new Error(
        `2D 대체 렌더러로 돌고 있습니다 (${field.renderer}). ` +
          "모양·움직임이 빠진 그림이 나오므로 캡처하지 않습니다. 탭을 새로고침하세요.",
      );
    }
    // 탭이 뒤에 있으면 브라우저가 requestAnimationFrame 을 멈추므로 렌더 루프가
    // 돌지 않고 capture() 는 영원히 대기한다. 이 창을 앞에 두고 실행해야 한다.
    const out = await Promise.race([
      field.capture(),
      sleep(5000).then(() => "timeout"),
    ]);
    if (out === "timeout")
      throw new Error("프레임이 그려지지 않습니다. 이 탭을 화면 맨 앞에 두고 다시 실행하세요.");
    if (!out) throw new Error("캡처에 실패했습니다.");
    return out;
  };

  const download = (name, dataUrl) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    a.click();
  };

  const FONT = '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

  // 파형은 캔버스 가운데에만 그려지므로 좌우 여백을 잘라낸다.
  const CROP_X = 0.26;
  const CROP_W = 0.48;

  function compose(shots, { cols, title, note }) {
    const first = shots[0].image;
    const sx = Math.round(first.width * CROP_X);
    const sw = Math.round(first.width * CROP_W);
    const sh = first.height;

    const PAD = 28;
    const GAP = 26;
    const HEAD = 76; // 패널 라벨 높이
    const FOOT = 40; // 패널 아래 설명 높이
    const rows = Math.ceil(shots.length / cols);

    const out = document.createElement("canvas");
    out.width = PAD * 2 + sw * cols + GAP * (cols - 1);
    out.height = PAD + (title ? 46 : 0) + rows * (HEAD + sh + FOOT) + (note ? 30 : 0);

    const g = out.getContext("2d");
    g.fillStyle = "#0a0a0e";
    g.fillRect(0, 0, out.width, out.height);

    let top = PAD;
    if (title) {
      g.fillStyle = "#f2f2f5";
      g.font = `600 27px ${FONT}`;
      g.fillText(title, PAD, top + 26);
      top += 46;
    }

    shots.forEach((shot, i) => {
      const x = PAD + (i % cols) * (sw + GAP);
      const y = top + Math.floor(i / cols) * (HEAD + sh + FOOT);

      g.fillStyle = "#111116";
      g.fillRect(x, y + HEAD - 8, sw, sh + 16);
      g.drawImage(shot.image, sx, 0, sw, sh, x, y + HEAD, sw, sh);

      if (shot.accent) {
        g.fillStyle = shot.accent;
        g.fillRect(x, y + 12, 4, 26);
      }
      g.fillStyle = "#f2f2f5";
      g.font = `600 24px ${FONT}`;
      g.fillText(shot.label, x + (shot.accent ? 16 : 0), y + 34);

      if (shot.sub) {
        g.fillStyle = "#8a8a95";
        g.font = `400 17px ${FONT}`;
        g.fillText(shot.sub, x, y + HEAD + sh + 30);
      }
    });

    if (note) {
      g.fillStyle = "#5a5a64";
      g.font = `400 15px ${FONT}`;
      g.fillText(note, PAD, out.height - 14);
    }
    return out;
  }

  // ── ① 하이브리드 vs AI 전용 ────────────────────────────────────
  async function compare() {
    const toggle = buttonByText("렌더링");
    if (!toggle) throw new Error("렌더링 토글을 찾지 못했습니다.");

    // 활성 모드는 emerald 색으로 강조된다 (text-emerald-400).
    const activeMode = () => {
      const on = [...toggle.querySelectorAll("*")].find((e) =>
        (e.className || "").includes("emerald"),
      );
      return on ? on.textContent.trim() : "";
    };

    const a = { image: await snap(), mode: activeMode() };
    toggle.click();
    await sleep(1100);
    const b = { image: await snap(), mode: activeMode() };

    if (a.mode === b.mode) throw new Error("렌더링 모드가 바뀌지 않았습니다.");
    const aIsHybrid = a.mode.includes("하이브리드");
    const hybrid = aIsHybrid ? a.image : b.image;
    const ai = aIsHybrid ? b.image : a.image;

    const t = media() ? media().currentTime.toFixed(1) : "?";
    const png = compose(
      [
        {
          image: hybrid,
          label: "하이브리드 (기본값)",
          sub: "크기·채도·움직임 = 실측 운율",
          accent: "#7fd48a",
        },
        {
          image: ai,
          label: "AI 전용 (비교군)",
          sub: "7채널 전부 AI 예측값",
          accent: "#e88a6a",
        },
      ],
      { cols: 2, note: `동일 구간 · t=${t}s` },
    ).toDataURL("image/png");

    download("그림4_하이브리드_비교.png", png);
    console.log("저장됨: 그림4_하이브리드_비교.png");
  }

  // ── ② 감정별 파형 격자 ─────────────────────────────────────────
  // 하단 감정 타임라인의 각 구간 한가운데를 클릭해 그 감정으로 이동한 뒤 촬영한다.
  // 업로드한 파일에는 <audio> 가 있지만 데모에는 없으므로, currentTime 을 건드리지
  // 않고 화면 클릭과 같은 경로(onPointerDown → onSeek)를 쓴다.
  function readTimeline() {
    const labels = [...document.querySelectorAll("div, span")].filter(
      (e) => e.children.length === 0 && (e.className || "").includes("truncate"),
    );
    return labels
      .map((label) => {
        const cell = label.parentElement;
        if (!cell) return null;
        return { name: (label.textContent || "").trim(), cell };
      })
      .filter(Boolean);
  }

  function seekTo(seg) {
    // 구간 한가운데의 clientX 를 그대로 넘긴다. 트랙도 같은 뷰포트 좌표를 쓰므로
    // 타임라인이 화면 밖으로 스크롤돼 있어도 계산이 어긋나지 않는다.
    const r = seg.cell.getBoundingClientRect();
    // React 쪽 onPointerDown 이 setPointerCapture 를 먼저 부르는데, 합성 이벤트의
    // pointerId 로는 NotFoundError 가 난다. 캡처 동안만 무해하게 비워 둔다.
    const real = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function () {};
    try {
      seg.cell.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
          pointerId: 1,
          buttons: 1,
        }),
      );
    } finally {
      Element.prototype.setPointerCapture = real;
    }
  }

  async function grid(cols = 2) {
    const segs = readTimeline();
    if (!segs.length) throw new Error("감정 타임라인을 찾지 못했습니다.");
    const shots = [];

    for (const seg of segs) {
      seekTo(seg);
      await sleep(1400); // 파형이 새 감정으로 완전히 전이될 때까지 기다린다
      shots.push({ image: await snap(), label: seg.name });
    }

    const png = compose(shots, {
      cols,
      title: "감정별 파형",
      note: "동일 렌더러 · 감정 범주만 변경",
    }).toDataURL("image/png");

    download("그림5_감정별_파형.png", png);
    console.log(`저장됨: 그림5_감정별_파형.png (${shots.length}종)`);
  }

  window.SS = { compare, grid, snap, compose, readTimeline, seekTo };
  console.log("준비 완료 →  SS.compare()   SS.grid()");
})();
