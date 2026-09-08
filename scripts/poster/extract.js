/*
 * 포스터 HTML → 레이아웃 JSON 추출기 (브라우저에서 실행)
 *
 * 렌더된 DOM을 걸어다니며 눈에 보이는 요소마다 위치·크기·글꼴·색을 읽어낸다.
 * CSS 레이아웃(flex/grid)을 해석하지 않고 "이미 계산된 결과"만 가져오므로,
 * 어떤 레이아웃 방식으로 만들었든 좌표가 정확히 나온다.
 *
 * 사용법: 콘솔에 붙여넣고
 *     copy(JSON.stringify(await extractPoster(), null, 1))
 * 또는 자동화에서 await extractPoster() 의 반환값을 그대로 저장.
 */
async function extractPoster(root) {
  root = root || document.body;

  const px = (v) => (v ? parseFloat(v) || 0 : 0);

  // "rgb(a)(...)" → {r,g,b,a}. 투명하면 a=0.
  function parseColor(s) {
    if (!s) return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0] | 0, g: p[1] | 0, b: p[2] | 0, a: p.length > 3 ? p[3] : 1 };
  }

  const hex = (c) =>
    c ? [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("") : null;

  // 그라디언트에서 첫 색만 뽑아 단색으로 근사한다. PPTX 도형이 CSS 그라디언트를
  // 그대로 못 받으므로, 근사한 것을 warnings 에 남겨 나중에 손볼 수 있게 한다.
  function firstGradientColor(bgImage) {
    if (!bgImage || bgImage === "none" || !bgImage.includes("gradient")) return null;
    const m = bgImage.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
    if (!m) return null;
    if (m[0].startsWith("#")) {
      let h = m[0].slice(1);
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
    }
    return parseColor(m[0]);
  }

  // 이 요소가 "직접" 가진 텍스트. 자식 요소의 글자는 그 자식이 따로 담당한다.
  function ownText(el) {
    let out = "";
    for (const n of el.childNodes) if (n.nodeType === 3) out += n.nodeValue;
    return out.replace(/\s+/g, " ").trim();
  }

  const warnings = [];
  const items = [];
  let order = 0;

  // SVG·canvas 를 PNG data URL 로. cairosvg 없이 브라우저가 직접 래스터화한다.
  async function rasterize(el, rect, scale = 3) {
    if (el.tagName === "CANVAS") {
      try { return el.toDataURL("image/png"); } catch { return null; }
    }
    const svg = new XMLSerializer().serializeToString(el);
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = blobUrl;
      });
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(rect.width * scale));
      c.height = Math.max(1, Math.round(rect.height * scale));  // scale = 래스터 배율(기본 3)
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // 이미 로드된 <img> 를 캔버스에 그려 PNG 로. SVG 이미지도 이 경로로 처리된다.
  async function rasterizeImg(el, rect, scale = 3) {
    try {
      if (!el.complete) await new Promise((r) => { el.onload = r; el.onerror = r; });
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(rect.width * scale));
      c.height = Math.max(1, Math.round(rect.height * scale));
      c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  async function toDataUrl(src) {
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  // 편집기는 아트보드를 확대/축소해서 보여 준다. transform 이 걸려 있으면
  // getBoundingClientRect 는 '화면에 보이는' 크기를 주지만 computed fontSize 는
  // 원래 값 그대로다. 그대로 두면 좌표와 글자 크기의 축척이 어긋난다.
  // offsetWidth 는 변형 전 레이아웃 폭이므로, 둘의 비가 곧 배율이다.
  const base = root.getBoundingClientRect();
  const scale = root.offsetWidth ? base.width / root.offsetWidth : 1;
  const win = root.ownerDocument.defaultView || window;
  const originX = base.left + win.scrollX;
  const originY = base.top + win.scrollY;

  async function walk(el) {
    const cs = win.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;

    const r = el.getBoundingClientRect();
    const box = {
      x: (r.left + win.scrollX - originX) / scale,
      y: (r.top + win.scrollY - originY) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
    const opacity = parseFloat(cs.opacity);
    if (box.w < 0.5 || box.h < 0.5 || opacity === 0) {
      for (const c of el.children) await walk(c);
      return;
    }

    // ── 그림 ────────────────────────────────────────────────
    if (el.tagName === "IMG" || el.tagName === "SVG" || el.tagName === "svg" || el.tagName === "CANVAS") {
      let data = null;
      if (el.tagName === "IMG") {
        data = await toDataUrl(el.currentSrc || el.src);
        // PPTX 는 SVG 를 못 넣는다. PNG/JPEG 가 아니면 캔버스로 래스터화한다.
        if (data && !/^data:image\/(png|jpe?g|gif|webp)/i.test(data)) {
          data = await rasterizeImg(el, { width: box.w, height: box.h });
        }
      } else {
        data = await rasterize(el, { width: box.w, height: box.h });
      }
      if (data) items.push({ kind: "image", order: order++, box, data });
      else warnings.push(`이미지를 읽지 못함: <${el.tagName.toLowerCase()}> at ${Math.round(box.x)},${Math.round(box.y)}`);
      return; // 그림 내부는 더 들어가지 않는다
    }

    // ── 배경 / 테두리 ───────────────────────────────────────
    const bg = parseColor(cs.backgroundColor);
    const grad = firstGradientColor(cs.backgroundImage);
    const bw = px(cs.borderTopWidth);
    const bcol = parseColor(cs.borderTopColor);
    const radius = px(cs.borderTopLeftRadius);

    if (grad) warnings.push(`그라디언트를 단색으로 근사함: ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}×${Math.round(box.h)}`);
    if (cs.boxShadow && cs.boxShadow !== "none") warnings.push(`그림자 생략됨: ${Math.round(box.x)},${Math.round(box.y)}`);

    const fill = grad || (bg && bg.a > 0.02 ? bg : null);
    const stroked = bw > 0.4 && bcol && bcol.a > 0.02;
    if (fill || stroked) {
      items.push({
        kind: "box",
        order: order++,
        box,
        fill: fill ? hex(fill) : null,
        fillAlpha: fill ? fill.a : 0,
        line: stroked ? { color: hex(bcol), width: bw, style: cs.borderTopStyle } : null,
        radius,
      });
    }

    // ── 글자 ────────────────────────────────────────────────
    const text = ownText(el);
    if (text) {
      const color = parseColor(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
      items.push({
        kind: "text",
        order: order++,
        box,
        text,
        font: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        size: px(cs.fontSize),
        weight: parseInt(cs.fontWeight, 10) || 400,
        italic: cs.fontStyle === "italic",
        color: hex(color),
        align: cs.textAlign,
        lineHeight: cs.lineHeight === "normal" ? px(cs.fontSize) * 1.2 : px(cs.lineHeight),
        letterSpacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
        padLeft: px(cs.paddingLeft),
        padTop: px(cs.paddingTop),
        padRight: px(cs.paddingRight),
      });
    }

    for (const c of el.children) await walk(c);
  }

  await walk(root);

  return {
    canvas: { width: base.width / scale, height: base.height / scale },
    scale,
    items,
    warnings,
    generatedAt: new Date().toISOString(),
  };
}

if (typeof window !== "undefined") window.extractPoster = extractPoster;

/*
 * 크롬에서 한 번에 쓰는 버전.
 *   1) 포스터 HTML 을 크롬에서 연다
 *   2) 이 파일 전체를 콘솔에 붙여넣는다
 *   3) downloadPosterLayout()  ← layout.json 이 다운로드된다
 * 루트 요소를 직접 고르려면 downloadPosterLayout('.poster') 처럼 선택자를 넘긴다.
 */
async function downloadPosterLayout(target) {
  let root = null;
  if (typeof target === "number") {
    root = (window.__roots || [])[target];
    if (!root) throw new Error(`${target}번 후보가 없습니다. findPosterRoots() 를 먼저 실행하세요.`);
  } else if (typeof target === "string") {
    root = document.querySelector(target);
    if (!root) throw new Error(`선택자를 찾지 못했습니다: ${target}`);
  } else if (target instanceof Element) {
    root = target;
  }
  const layout = await extractPoster(root || undefined);
  const blob = new Blob([JSON.stringify(layout)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "layout.json";
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(
    `추출 완료 — ${Math.round(layout.canvas.width)}×${Math.round(layout.canvas.height)}px` +
      (Math.abs(layout.scale - 1) > 0.01 ? ` (화면 배율 ${layout.scale.toFixed(2)} 보정됨)` : "") +
      `, 요소 ${layout.items.length}개, 손볼 곳 ${layout.warnings.length}건`,
  );
  return layout;
}
if (typeof window !== "undefined") window.downloadPosterLayout = downloadPosterLayout;

/*
 * 포스터 아트보드 후보 찾기.
 *
 * Claude Design 편집기는 아트보드를 편집기 UI 안에, 때로는 iframe 안에 넣는다.
 * 통째로 추출하면 편집기 껍데기까지 딸려 오므로, 먼저 후보를 보고 고른다.
 *
 *   findPosterRoots()          ← 목록 출력
 *   downloadPosterLayout(0)    ← 0번 후보로 추출
 */
function findPosterRoots(minWidth = 700) {
  const docs = [document];
  for (const f of document.querySelectorAll("iframe")) {
    try {
      if (f.contentDocument) docs.push(f.contentDocument); // 동일 출처만 접근 가능
    } catch { /* 교차 출처 iframe 은 건너뛴다 */ }
  }

  const found = [];
  for (const doc of docs) {
    for (const el of doc.querySelectorAll("body, body *")) {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (w < minWidth || h < minWidth) continue;
      if (!el.children.length) continue;
      found.push({ el, w, h, ratio: h / w, doc });
    }
  }

  // 아트보드는 보통 A 규격 비율(1.414) 근처이고, 자식이 많다.
  found.sort((a, b) => Math.abs(a.ratio - 1.414) - Math.abs(b.ratio - 1.414));
  const top = found.slice(0, 12);

  window.__roots = top.map((f) => f.el);
  console.log("후보 (번호를 downloadPosterLayout 에 넘기세요):");
  top.forEach((f, i) => {
    const id = f.el.id ? "#" + f.el.id : "";
    const cls = f.el.className && typeof f.el.className === "string"
      ? "." + f.el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    const where = f.doc === document ? "" : "  [iframe 안]";
    console.log(
      `  ${i}: ${f.w}×${f.h}  비율 ${f.ratio.toFixed(3)}  ` +
        `<${f.el.tagName.toLowerCase()}${id}${cls}>  자식 ${f.el.children.length}개${where}`,
    );
  });
  console.log("\nA0 세로면 비율이 1.414 에 가깝습니다. 맨 위 후보부터 시도해 보세요.");
  return top.map((f) => ({ index: found.indexOf(f), w: f.w, h: f.h, ratio: +f.ratio.toFixed(3) }));
}
if (typeof window !== "undefined") window.findPosterRoots = findPosterRoots;
