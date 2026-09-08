(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // frontend/src/lib/emotionField.ts
  var FALLBACK_BG = "radial-gradient(circle at 50% 45%, hsl(265 50% 22%), #050507 70%)";
  function createEmotionField(canvas, opts = {}) {
    let transparent = !!opts.transparent;
    let visual = {
      shape: "simple_circle",
      color: { h: 0, s: 0, l: 55 },
      size: 0.5,
      motion: { type: "still", amplitude: 0, speed: 0 }
    };
    let burst = 0;
    let raf = null;
    function start2DFallback() {
      const c2 = document.createElement("canvas");
      c2.className = canvas.className;
      c2.style.cssText = canvas.style.cssText;
      const ctx = c2.getContext("2d");
      if (!ctx || !canvas.parentElement) {
        canvas.style.background = FALLBACK_BG;
        return noopHandle();
      }
      canvas.style.visibility = "hidden";
      canvas.parentElement.insertBefore(c2, canvas.nextSibling);
      const dpr2 = Math.min(
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        1.5
      );
      const resize2 = () => {
        const rect = c2.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr2));
        const h = Math.max(1, Math.round(rect.height * dpr2));
        if (w === c2.width && h === c2.height) return;
        c2.width = w;
        c2.height = h;
      };
      resize2();
      window.addEventListener("resize", resize2);
      const ro2 = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize2()) : null;
      ro2?.observe(c2);
      const cur2 = uniformsFor(visual);
      const draw = () => {
        if (c2.width <= 1 || c2.height <= 1) {
          raf = requestAnimationFrame(draw);
          return;
        }
        const t = uniformsFor(visual);
        const ease = 0.08;
        cur2.hue = lerpHue(cur2.hue, t.hue, ease);
        cur2.sat += (t.sat - cur2.sat) * ease;
        cur2.light += (t.light - cur2.light) * ease;
        cur2.bright += (t.bright - cur2.bright) * ease;
        burst *= 0.94;
        const W = c2.width;
        const H = c2.height;
        ctx.clearRect(0, 0, W, H);
        if (!transparent) {
          ctx.fillStyle = "#050507";
          ctx.fillRect(0, 0, W, H);
        }
        const cx = W / 2;
        const cy = H / 2;
        const R = Math.min(W, H) * (0.42 + 0.14 * cur2.bright) * (1 + 0.18 * burst);
        const hue = Math.round(cur2.hue);
        const sat = Math.round(Math.max(0.35, Math.min(1, cur2.sat)) * 100);
        const light = Math.round(
          Math.max(0, Math.min(1, cur2.light * 0.6 + 0.3)) * 100
        );
        const a0 = Math.max(0, Math.min(1, 0.95 + burst * 0.05));
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, ${a0})`);
        g.addColorStop(0.45, `hsla(${hue}, ${sat}%, ${light}%, 0.55)`);
        g.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.fill();
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
      return {
        renderer: "fallback-2d",
        setVisual(v) {
          visual = v;
        },
        setTransparent(x) {
          transparent = x;
        },
        pulse(strength = 0.45) {
          burst = Math.min(1.4, burst + strength);
        },
        destroy() {
          if (raf !== null) cancelAnimationFrame(raf);
          ro2?.disconnect();
          window.removeEventListener("resize", resize2);
          c2.remove();
          canvas.style.visibility = "";
        }
      };
    }
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "high-performance"
    });
    if (!gl) return start2DFallback();
    const program = buildProgram(gl);
    if (!program) return start2DFallback();
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = {
      res: gl.getUniformLocation(program, "u_res"),
      time: gl.getUniformLocation(program, "u_time"),
      hue: gl.getUniformLocation(program, "u_hue"),
      sat: gl.getUniformLocation(program, "u_sat"),
      light: gl.getUniformLocation(program, "u_light"),
      turb: gl.getUniformLocation(program, "u_turb"),
      flow: gl.getUniformLocation(program, "u_flow"),
      contrast: gl.getUniformLocation(program, "u_contrast"),
      bright: gl.getUniformLocation(program, "u_bright"),
      spread: gl.getUniformLocation(program, "u_spread"),
      overlay: gl.getUniformLocation(program, "u_overlay"),
      edgeTurb: gl.getUniformLocation(program, "u_edgeTurb"),
      edgeFreq: gl.getUniformLocation(program, "u_edgeFreq"),
      breathe: gl.getUniformLocation(program, "u_breathe"),
      elong: gl.getUniformLocation(program, "u_elong"),
      sharp: gl.getUniformLocation(program, "u_sharp"),
      unsure: gl.getUniformLocation(program, "u_unsure")
    };
    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      1.5
    );
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
    ro?.observe(canvas);
    const cur = uniformsFor(visual);
    let lastT = performance.now();
    const start2 = lastT;
    const render = (now) => {
      if (canvas.width <= 1 || canvas.height <= 1) {
        raf = requestAnimationFrame(render);
        return;
      }
      const dt = Math.min(0.05, (now - lastT) / 1e3);
      lastT = now;
      const target = uniformsFor(visual);
      const b = burst;
      burst *= Math.pow(0.05, dt);
      const ease = Math.min(0.9, 1 - Math.pow(0.25, dt) + Math.min(0.6, b) * 0.08);
      cur.hue = lerpHue(cur.hue, target.hue, ease);
      cur.sat += (target.sat - cur.sat) * ease;
      cur.light += (target.light - cur.light) * ease;
      cur.turb += (target.turb - cur.turb) * ease;
      cur.flow += (target.flow - cur.flow) * ease;
      cur.contrast += (target.contrast - cur.contrast) * ease;
      cur.bright += (target.bright - cur.bright) * ease;
      cur.sharp += (target.sharp - cur.sharp) * ease;
      cur.unsure += (target.unsure - cur.unsure) * ease;
      cur.edgeTurb += (target.edgeTurb - cur.edgeTurb) * ease;
      cur.edgeFreq += (target.edgeFreq - cur.edgeFreq) * ease;
      cur.breathe += (target.breathe - cur.breathe) * ease;
      cur.elong += (target.elong - cur.elong) * ease;
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, (now - start2) / 1e3);
      gl.uniform1f(U.hue, cur.hue / 360);
      gl.uniform1f(U.sat, cur.sat);
      gl.uniform1f(U.light, cur.light);
      gl.uniform1f(U.turb, cur.turb);
      gl.uniform1f(U.flow, cur.flow);
      gl.uniform1f(U.contrast, Math.min(1, cur.contrast + b * 0.25));
      gl.uniform1f(U.bright, cur.bright + b * 0.35);
      gl.uniform1f(U.spread, 0.13);
      gl.uniform1f(U.overlay, transparent ? 1 : 0);
      gl.uniform1f(U.edgeTurb, cur.edgeTurb);
      gl.uniform1f(U.edgeFreq, cur.edgeFreq);
      gl.uniform1f(U.breathe, cur.breathe + b * 0.15);
      gl.uniform1f(U.elong, cur.elong);
      gl.uniform1f(U.sharp, cur.sharp);
      gl.uniform1f(U.unsure, cur.unsure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return {
      renderer: "webgl",
      setVisual(v) {
        visual = v;
      },
      setTransparent(t) {
        transparent = t;
      },
      pulse(strength = 0.45) {
        burst = Math.min(1.4, burst + strength);
      },
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        ro?.disconnect();
        window.removeEventListener("resize", resize);
        gl.deleteProgram(program);
        gl.deleteBuffer(buf);
      }
    };
  }
  function noopHandle() {
    return {
      renderer: "none",
      setVisual() {
      },
      setTransparent() {
      },
      pulse() {
      },
      destroy() {
      }
    };
  }
  var SHARPNESS_BY_SHAPE = {
    jagged_star: 1,
    // anger, sarcasm
    trembling_spikes: 0.92,
    // fear
    expanding_burst: 0.55,
    // joy, surprise
    simple_circle: 0.4,
    // neutral
    flowing_wave: 0.18,
    // sadness
    drooping_ellipse: 0.12,
    // resignation
    soft_circle: 0.05
    // sincerity
  };
  function uniformsFor(v) {
    const m = v.motion;
    let turb;
    let contrast;
    let edgeTurb;
    let edgeFreq;
    let breathe;
    let elong;
    switch (m.type) {
      case "shake":
        turb = 0.95;
        contrast = 0.9;
        edgeTurb = 0.85;
        edgeFreq = 7;
        breathe = 0.35;
        elong = 1.05;
        break;
      case "tremor":
        turb = 1;
        contrast = 0.8;
        edgeTurb = 0.95;
        edgeFreq = 9;
        breathe = 0.3;
        elong = 1;
        break;
      case "pulse":
        turb = 0.5;
        contrast = 0.55;
        edgeTurb = 0.45;
        edgeFreq = 5;
        breathe = 0.85;
        elong = 1.05;
        break;
      case "slow_drift":
        turb = 0.28;
        contrast = 0.32;
        edgeTurb = 0.2;
        edgeFreq = 2;
        breathe = 0.25;
        elong = 1.4;
        break;
      case "sink":
        turb = 0.3;
        contrast = 0.3;
        edgeTurb = 0.22;
        edgeFreq = 2;
        breathe = 0.2;
        elong = 1.5;
        break;
      default:
        turb = 0.2;
        contrast = 0.35;
        edgeTurb = 0.15;
        edgeFreq = 3;
        breathe = 0.35;
        elong = 1.1;
    }
    turb *= 0.55 + m.amplitude * 0.6;
    edgeTurb *= 0.5 + m.amplitude * 0.7;
    const flow = 0.12 + m.speed * 0.6 + (m.type === "shake" || m.type === "tremor" ? 0.25 : 0);
    const bright = 0.55 + v.size * 0.7;
    const sharp = SHARPNESS_BY_SHAPE[v.shape] ?? 0.4;
    return {
      unsure: Math.max(0, Math.min(1, v.uncertainty ?? 0)),
      sharp,
      hue: v.color.h,
      sat: Math.min(1, v.color.s / 100),
      light: v.color.l / 100,
      turb: Math.min(1.2, turb),
      flow,
      contrast,
      bright,
      edgeTurb: Math.min(1, edgeTurb),
      edgeFreq,
      breathe,
      elong
    };
  }
  var VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
  var FRAG = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_time, u_hue, u_sat, u_light, u_turb, u_flow, u_contrast, u_bright, u_spread, u_overlay;
uniform float u_edgeTurb, u_edgeFreq, u_breathe, u_elong, u_sharp;
uniform float u_unsure;

vec3 hsl2rgb(vec3 hsl){
  float h=hsl.x, s=hsl.y, l=hsl.z;
  float c=(1.0-abs(2.0*l-1.0))*s;
  float hp=mod(h,1.0)*6.0;
  float x=c*(1.0-abs(mod(hp,2.0)-1.0));
  vec3 rgb;
  if(hp<1.0) rgb=vec3(c,x,0.0);
  else if(hp<2.0) rgb=vec3(x,c,0.0);
  else if(hp<3.0) rgb=vec3(0.0,c,x);
  else if(hp<4.0) rgb=vec3(0.0,x,c);
  else if(hp<5.0) rgb=vec3(x,0.0,c);
  else rgb=vec3(c,0.0,x);
  return rgb + (l-0.5*c);
}
vec2 hash2(vec2 p){
  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));
  return -1.0+2.0*fract(sin(p)*43758.5453123);
}
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(dot(hash2(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),
                 dot(hash2(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),
             mix(dot(hash2(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),
                 dot(hash2(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.0; a*=0.5; }
  return v;
}

// A voice waveform rather than a blob.
//
// The band reads as SOUND at a glance, which a radial glow never did \u2014 and in
// hybrid rendering it is honest about it, because the height and rate of the
// wave come from the measured voice, not from the classifier's guess.
//
// Three layered waves at different frequencies and drift speeds, each filled
// from the centre line outward, blended additively. One wave looks like a
// readout; layered ones read as a living voice, and the overlaps give the
// depth the flat line lacks.
// Reshape a wave WITHOUT changing its amplitude, so a peak can be a needle or
// a plateau while still reaching the same height.
//
//   k > 1  the curve hugs zero then rises late  \u2192 a narrow, pointed peak
//   k < 1  it rises immediately and flattens    \u2192 a broad, blunt one
//
// This is the knob that makes the form read as sharp rather than as something
// soft and anatomical: roundness is what made the first version unpleasant to
// look at, not the pinch at the zero crossings.
float sharpen(float x, float k){
  return sign(x) * pow(abs(x), k);
}

float waveField(vec2 p, float freq, float phase, float amp, float t, float turb){
  // A Gaussian rather than a linear taper, and a tight one: the movement
  // should read as coming from one place near the middle. A wide envelope
  // spreads the same energy across the frame and the wave stops having a
  // centre to look at.
  float env = exp(-p.x * p.x * 3.4);

  // How pointed this stretch of the wave is. Driven by measured vocal
  // instability \u2014 a shaky voice gets needles, a steady one gets broad swells \u2014
  // and modulated along x so neighbouring peaks differ instead of the whole
  // band sharing one silhouette.
  float local = fbm(vec2(p.x * 0.85 + phase, t * 0.12));
  // Two sources, deliberately: WHICH emotion this is (u_sharp, from the shape
  // the mapping chose) sets the baseline angularity, and the measured vocal
  // instability pushes it further. So anger is angular even when spoken
  // steadily, and any voice gets needles when it shakes.
  float k = mix(0.70, 3.4,
      clamp(u_sharp * 0.62 + turb * 0.55 + local * 0.30, 0.0, 1.0));

  // Several harmonics, none of them multiples of each other, so the shape
  // never visibly repeats across the band. Each is sharpened separately, which
  // is what varies how much horizontal room a peak takes to reach its height.
  float w = sharpen(sin(p.x * freq + t + phase), k) * 0.55
          + sharpen(sin(p.x * freq * 1.83 - t * 0.7 + phase), k * 0.8) * 0.28
          + sharpen(sin(p.x * freq * 0.41 + t * 0.45), k * 1.35) * 0.34;

  // Turbulence roughens the outline on top of that.
  w += fbm(vec2(p.x * 2.4 + t * 0.6, phase)) * turb * 0.9;

  w *= env * amp;

  // Fill from the centre line outward, mirrored, the way a waveform is drawn.
  // The pinch where the wave crosses zero is KEPT: it is what makes the form
  // read as a signal rather than as something organic.
  float h = abs(w);
  float body = smoothstep(h + 0.028, h - 0.028, abs(p.y));
  float halo = exp(-max(0.0, abs(p.y) - h) * 15.0);
  return clamp(body + halo * 0.30, 0.0, 1.0);
}

void main(){
  float aspect=u_res.x/u_res.y;
  vec2 p=(v_uv-0.5)*vec2(aspect,1.0)*2.4;
  float t=u_time*u_flow*2.2;

  // Height follows the measured loudness; breathing keeps it alive when the
  // voice is steady.
  // Kept to a band rather than filling the frame: the caption sits below it and
  // the point is to be read alongside the picture, not to replace it.
  float amp = (0.15 + u_bright * 0.24)
            * (1.0 + 0.13 * u_breathe * sin(u_time * 1.5));
  // edgeFreq already carries "how agitated" from the motion rules, so it maps
  // straight onto how tightly packed the wave is.
  float freq = 2.1 + u_edgeFreq * 0.75;
  float turb = u_turb * 0.55 + u_edgeTurb * 0.35;

  float w1 = waveField(p / vec2(u_elong, 1.0), freq,        0.0, amp,        t,        turb);
  float w2 = waveField(p / vec2(u_elong, 1.0), freq * 0.63, 2.1, amp * 0.78, t * 0.78, turb * 0.8);
  float w3 = waveField(p / vec2(u_elong, 1.0), freq * 1.47, 4.3, amp * 0.55, t * 1.25, turb * 1.2);

  float vis = clamp(w1 * 0.8 + w2 * 0.5 + w3 * 0.34, 0.0, 1.0);
  // The flat baseline that runs out to either side is faded too, so the band
  // ends instead of touching the edge of the frame.
  vis *= exp(-abs(p.x) * 0.55);
  vis = pow(vis, mix(1.5, 0.7, u_contrast));

  // Hue drifts a little across the band and between layers, which is what
  // gives the reference look its gradient instead of one flat colour.
  float hueShift = p.x * 0.055 + (w2 - w3) * 0.045;
  float hue = u_hue + hueShift * u_spread * 2.0;
  // Lightness has to stay well short of white or the hue \u2014 the one channel
  // carrying which emotion this is \u2014 disappears into the blowout.
  float light = clamp(u_light * 0.52 + vis * 0.22 * u_bright, 0.03, 0.72);
  vec3 field = hsl2rgb(vec3(hue, clamp(u_sat,0.0,1.0), light));
  // A highlight only in the very core of the band, not across the body.
  field += pow(vis, 7.0) * u_bright * 0.22;

  // Doubt lowers presence. The form keeps its outline and its size \u2014 those are
  // measurements and they are not in question \u2014 and simply asserts itself less.
  //
  // Opacity rather than colour: in hybrid rendering saturation already means
  // measured arousal, so dimming the colour for low confidence made a calm
  // voice and an unsure classifier look identical to the viewer.
  float fade = 1.0 - u_unsure * 0.72;

  if(u_overlay>0.5){
    gl_FragColor = vec4(field, clamp(vis*u_bright*1.2*fade, 0.0, 1.0));
  } else {
    vec3 bg = hsl2rgb(vec3(mod(u_hue,1.0), 0.4, 0.035));
    vec3 col = mix(bg, field, vis*fade) + field*vis*0.35*fade;
    gl_FragColor = vec4(col, 1.0);
  }
}`;
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      console.error(
        "SoundShape shader compile failed:",
        log && log.trim() ? log : "(no log)",
        "| contextLost:",
        gl.isContextLost(),
        "| glError:",
        gl.getError()
      );
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function buildProgram(gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    if (!prog) return null;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("SoundShape program link error:", gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }
  function shortHue(a, b) {
    return (b - a + 540) % 360 - 180;
  }
  function lerpHue(a, b, k) {
    return (a + shortHue(a, b) * k + 360) % 360;
  }

  // extension/src/feedback.ts
  var API_BASE = "http://localhost:8000";
  var CONSENT_KEY = "soundshape_feedback_consent";
  async function getConsent() {
    try {
      const got = await chrome.storage?.local.get(CONSENT_KEY);
      const v = got?.[CONSENT_KEY];
      return v === "granted" || v === "declined" ? v : "unset";
    } catch {
      return "unset";
    }
  }
  async function setConsent(v) {
    try {
      await chrome.storage?.local.set({ [CONSENT_KEY]: v });
    } catch {
    }
  }
  async function fetchConfig() {
    try {
      const res = await fetch(`${API_BASE}/feedback/config`);
      if (!res.ok) return null;
      const cfg = await res.json();
      return cfg.enabled ? cfg : null;
    } catch {
      return null;
    }
  }
  async function submit(id, label, ms) {
    try {
      const body = new FormData();
      body.append("feedback_id", id);
      body.append("label", label);
      body.append("response_ms", String(Math.round(ms)));
      await fetch(`${API_BASE}/feedback`, { method: "POST", body });
    } catch {
    }
  }
  var FeedbackController = class {
    constructor() {
      __publicField(this, "config", null);
      __publicField(this, "consent", "unset");
      __publicField(this, "card", null);
      __publicField(this, "lastShownAt", Number.NEGATIVE_INFINITY);
      __publicField(this, "shownThisVideo", 0);
      __publicField(this, "seen", /* @__PURE__ */ new Set());
      __publicField(this, "destroyed", false);
    }
    /** Load config + consent. Safe to call before the stream starts. */
    async init() {
      const [cfg, consent] = await Promise.all([fetchConfig(), getConsent()]);
      if (this.destroyed) return;
      this.config = cfg;
      this.consent = consent;
    }
    resetForNewVideo() {
      this.shownThisVideo = 0;
      this.seen.clear();
      this.dismiss();
    }
    /** Called when playback enters a segment; no-ops unless a prompt is due. */
    maybeShow(feedbackId, host) {
      if (!feedbackId || !this.config || this.destroyed) return;
      if (this.consent === "declined" || this.card) return;
      if (this.seen.has(feedbackId)) return;
      if (this.shownThisVideo >= this.config.max_prompts_per_video) return;
      const now = Date.now();
      if (now - this.lastShownAt < this.config.min_interval_seconds * 1e3) return;
      this.seen.add(feedbackId);
      this.shownThisVideo += 1;
      this.lastShownAt = now;
      this.card = this.consent === "unset" ? this.buildConsent(host) : this.buildQuestion(host, feedbackId);
    }
    dismiss() {
      this.card?.remove();
      this.card = null;
    }
    destroy() {
      this.destroyed = true;
      this.dismiss();
    }
    // ── DOM ────────────────────────────────────────────────────────────
    shell(host) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed",
        right: "20px",
        bottom: "76px",
        // clears the ✦ SoundShape button
        width: "300px",
        zIndex: "100000",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,.15)",
        background: "rgba(24,24,27,.97)",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 8px 32px rgba(0,0,0,.5)",
        overflow: "hidden"
      });
      el.className = "soundshape-fb";
      host.appendChild(el);
      return el;
    }
    button(label, onClick) {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        padding: "7px 4px",
        borderRadius: "8px",
        border: "1px solid rgba(255,255,255,.15)",
        background: "transparent",
        color: "rgba(255,255,255,.9)",
        fontSize: "12px",
        cursor: "pointer",
        fontFamily: "inherit"
      });
      b.addEventListener("mouseenter", () => {
        b.style.background = "rgba(255,255,255,.1)";
      });
      b.addEventListener("mouseleave", () => {
        b.style.background = "transparent";
      });
      b.addEventListener("click", onClick);
      return b;
    }
    buildConsent(host) {
      const el = this.shell(host);
      const pad = document.createElement("div");
      pad.style.padding = "14px";
      const title = document.createElement("div");
      title.textContent = "\uAC10\uC815 \uC778\uC2DD\uC744 \uD568\uAED8 \uAC1C\uC120\uD560\uAE4C\uC694?";
      Object.assign(title.style, { fontSize: "13px", fontWeight: "600" });
      const body = document.createElement("div");
      body.innerHTML = "AI\uAC00 \uD5F7\uAC08\uB9B0 \uAD6C\uAC04\uC5D0\uC11C \uAC00\uB054 \uC9E7\uAC8C \uC5EC\uCB64\uBD05\uB2C8\uB2E4. \uB2F5\uBCC0\uC740 \uC815\uD655\uB3C4 \uAC1C\uC120\uC5D0\uB9CC \uC4F0\uC774\uBA70, <strong>\uC74C\uC131\uC740 \uC800\uC7A5\uD558\uC9C0 \uC54A\uACE0</strong> \uBD84\uC11D\uB41C \uC22B\uC790\uB9CC \uC800\uC7A5\uD569\uB2C8\uB2E4.";
      Object.assign(body.style, {
        fontSize: "11.5px",
        lineHeight: "1.6",
        color: "rgba(255,255,255,.7)",
        marginTop: "8px"
      });
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", gap: "8px", marginTop: "12px" });
      const yes = this.button("\uCC38\uC5EC\uD558\uAE30", () => {
        void setConsent("granted");
        this.consent = "granted";
        this.dismiss();
      });
      Object.assign(yes.style, {
        flex: "1",
        background: "#fff",
        color: "#000",
        border: "none",
        fontWeight: "500"
      });
      yes.addEventListener("mouseenter", () => yes.style.background = "#eee");
      yes.addEventListener("mouseleave", () => yes.style.background = "#fff");
      const no = this.button("\uC0AC\uC591\uD560\uAC8C\uC694", () => {
        void setConsent("declined");
        this.consent = "declined";
        this.dismiss();
      });
      row.append(yes, no);
      pad.append(title, body, row);
      el.appendChild(pad);
      return el;
    }
    buildQuestion(host, feedbackId) {
      const cfg = this.config;
      const el = this.shell(host);
      const shownAt = Date.now();
      const pad = document.createElement("div");
      pad.style.padding = "14px 14px 12px";
      const head = document.createElement("div");
      Object.assign(head.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "8px"
      });
      const q = document.createElement("div");
      q.textContent = cfg.question;
      Object.assign(q.style, { fontSize: "13px", fontWeight: "600" });
      const close = this.button("\xD7", () => this.dismiss());
      Object.assign(close.style, {
        border: "none",
        padding: "0 6px",
        fontSize: "16px",
        color: "rgba(255,255,255,.4)"
      });
      head.append(q, close);
      const grid = document.createElement("div");
      Object.assign(grid.style, {
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "6px",
        marginTop: "12px"
      });
      const answer = (value) => {
        void submit(feedbackId, value, Date.now() - shownAt);
        pad.innerHTML = "";
        const thanks = document.createElement("div");
        thanks.textContent = "\uACE0\uB9D9\uC2B5\uB2C8\uB2E4 \u2014 \uC815\uD655\uB3C4 \uAC1C\uC120\uC5D0 \uBC18\uC601\uD560\uAC8C\uC694.";
        Object.assign(thanks.style, {
          fontSize: "12.5px",
          color: "rgba(255,255,255,.8)",
          textAlign: "center",
          padding: "10px 0"
        });
        pad.appendChild(thanks);
        window.setTimeout(() => this.dismiss(), 900);
      };
      for (const o of cfg.options) {
        grid.appendChild(this.button(o.label, () => answer(o.value)));
      }
      const unsure = this.button(
        cfg.unsure_label,
        () => answer(cfg.unsure_value)
      );
      Object.assign(unsure.style, {
        border: "none",
        width: "100%",
        marginTop: "8px",
        color: "rgba(255,255,255,.5)"
      });
      pad.append(head, grid, unsure);
      el.appendChild(pad);
      const track = document.createElement("div");
      Object.assign(track.style, {
        height: "3px",
        width: "100%",
        background: "rgba(255,255,255,.1)"
      });
      const bar = document.createElement("div");
      Object.assign(bar.style, {
        height: "100%",
        width: "100%",
        background: "rgba(255,255,255,.5)",
        animation: `soundshape-fb-drain ${cfg.display_seconds}s linear forwards`
      });
      bar.addEventListener("animationend", () => this.dismiss());
      el.addEventListener("mouseenter", () => {
        bar.style.animationPlayState = "paused";
      });
      el.addEventListener("mouseleave", () => {
        bar.style.animationPlayState = "running";
      });
      track.appendChild(bar);
      el.appendChild(track);
      ensureKeyframes();
      return el;
    }
  };
  var keyframesAdded = false;
  function ensureKeyframes() {
    if (keyframesAdded || document.getElementById("soundshape-fb-style")) return;
    const style = document.createElement("style");
    style.id = "soundshape-fb-style";
    style.textContent = "@keyframes soundshape-fb-drain { from { width: 100%; } to { width: 0%; } }";
    document.head.appendChild(style);
    keyframesAdded = true;
  }

  // extension/src/content.ts
  var API_BASE2 = "http://localhost:8000";
  var PREBUFFER_SEC = 4;
  var PAUSE_MARGIN = 0.25;
  var RESUME_MARGIN = 1;
  var session = null;
  function getVideoId() {
    return new URLSearchParams(location.search).get("v");
  }
  function findVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video") || null;
  }
  function findPlayer() {
    return document.querySelector("#movie_player") || document.querySelector(".html5-video-player") || findVideo()?.parentElement || null;
  }
  function injectButton() {
    if (document.getElementById("soundshape-btn")) return;
    const btn = document.createElement("button");
    btn.id = "soundshape-btn";
    btn.textContent = "\u2726 SoundShape";
    Object.assign(btn.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "99999",
      padding: "10px 16px",
      borderRadius: "999px",
      border: "none",
      background: "linear-gradient(135deg,#7c3aed,#ec4899)",
      color: "#fff",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 4px 18px rgba(0,0,0,.45)",
      fontFamily: "system-ui, sans-serif"
    });
    btn.addEventListener("click", () => {
      if (session) {
        session.stop();
        session = null;
        btn.textContent = "\u2726 SoundShape";
      } else {
        btn.textContent = "\u2726 SoundShape \u2014 stop";
        start(btn);
      }
    });
    document.body.appendChild(btn);
  }
  async function start(btn) {
    const video = findVideo();
    const player = findPlayer();
    if (!video || !player) {
      alert("SoundShape: couldn't find the YouTube video element.");
      btn.textContent = "\u2726 SoundShape";
      return;
    }
    if (getComputedStyle(player).position === "static") {
      player.style.position = "relative";
    }
    const overlay = document.createElement("div");
    overlay.id = "soundshape-overlay";
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "30"
    });
    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "absolute",
      left: "0",
      // The wave draws down the middle of its own canvas, so this band is
      // positioned to put that middle just above the caption line at 13% —
      // matching the web app. Centred on the frame it sat across the actors and
      // whatever they were holding, which is the part the viewer is watching.
      bottom: "15%",
      width: "100%",
      height: "36%",
      opacity: "0.95"
    });
    const caption = document.createElement("div");
    Object.assign(caption.style, {
      position: "absolute",
      left: "0",
      right: "0",
      // Sit like a normal subtitle (~13% up), clear of YouTube's control bar and
      // the very bottom edge so long lines don't spill below the video.
      bottom: "13%",
      textAlign: "center",
      padding: "0 8%",
      color: "#fff",
      fontSize: "24px",
      fontWeight: "600",
      textShadow: "0 2px 10px rgba(0,0,0,.95)",
      fontFamily: "system-ui, sans-serif"
    });
    const status = document.createElement("div");
    Object.assign(status.style, {
      position: "absolute",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,.6)",
      color: "#fff",
      padding: "8px 16px",
      borderRadius: "999px",
      fontSize: "13px",
      fontFamily: "system-ui, sans-serif"
    });
    status.textContent = "SoundShape: analyzing the opening\u2026";
    overlay.appendChild(canvas);
    overlay.appendChild(caption);
    overlay.appendChild(status);
    player.appendChild(overlay);
    const field = createEmotionField(canvas, { transparent: true });
    const segs = [];
    let horizon = 0;
    let done = false;
    let started = false;
    let buffering = false;
    let lastIdx = -1;
    let stopped = false;
    let raf = 0;
    let pausedByUs = false;
    const ctrl = new AbortController();
    const feedbackCtl = new FeedbackController();
    void feedbackCtl.init();
    session = {
      videoId: getVideoId(),
      stop: () => {
        if (stopped) return;
        stopped = true;
        ctrl.abort();
        cancelAnimationFrame(raf);
        field.destroy();
        overlay.remove();
        feedbackCtl.destroy();
        if (pausedByUs && video.paused) void video.play().catch(() => {
        });
      }
    };
    const setStatus = (s) => {
      if (s) {
        status.textContent = s;
        status.style.display = "";
      } else {
        status.style.display = "none";
      }
    };
    const maybeStart = () => {
      if (started || stopped) return;
      if (horizon >= PREBUFFER_SEC || done) {
        started = true;
        setStatus(null);
        video.currentTime = 0;
        pausedByUs = false;
        void video.play().catch(() => {
        });
      }
    };
    const loop = () => {
      if (stopped) return;
      const ct = video.currentTime;
      let idx = -1;
      for (let i = segs.length - 1; i >= 0; i--) {
        if (ct >= segs[i].t) {
          idx = i;
          break;
        }
      }
      if (idx >= 0) {
        const conf = segs[idx].emotion?.category_confidence;
        field.setVisual({
          ...segs[idx].visual,
          uncertainty: conf == null ? 0 : Math.max(0, Math.min(1, 1 - conf / 0.85))
        });
        caption.textContent = segs[idx].speaker_changed ? `\u2014 ${segs[idx].text}` : segs[idx].text;
        if (idx !== lastIdx) {
          field.pulse();
          lastIdx = idx;
          feedbackCtl.maybeShow(segs[idx].emotion?.feedback_id, document.body);
        }
      }
      if (!done) {
        if (started && !video.paused && ct >= horizon - PAUSE_MARGIN) {
          video.pause();
          buffering = true;
          pausedByUs = true;
          setStatus("buffering\u2026");
        } else if (buffering && horizon >= ct + RESUME_MARGIN) {
          buffering = false;
          pausedByUs = false;
          setStatus(null);
          void video.play().catch(() => {
          });
        }
      } else if (buffering) {
        buffering = false;
        pausedByUs = false;
        setStatus(null);
        void video.play().catch(() => {
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    video.pause();
    pausedByUs = true;
    try {
      const form = new FormData();
      form.append("url", location.href);
      const res = await fetch(`${API_BASE2}/process/stream/url`, {
        method: "POST",
        body: form,
        signal: ctrl.signal
      });
      if (!res.ok || !res.body) throw new Error(`backend ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const handle = (line) => {
        const s = line.trim();
        if (!s) return;
        let ev;
        try {
          ev = JSON.parse(s);
        } catch {
          return;
        }
        if (ev.type === "status") setStatus("downloading audio\u2026");
        else if (ev.type === "segment") {
          const seg = ev;
          segs.push(seg);
          horizon = Math.max(horizon, seg.t + seg.duration);
          maybeStart();
        } else if (ev.type === "done") {
          done = true;
          maybeStart();
        } else if (ev.type === "error") {
          setStatus("error: " + String(ev.message));
        }
      };
      for (; ; ) {
        if (stopped) break;
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          handle(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setStatus(
        "SoundShape: backend not reachable \u2014 is uvicorn running on :8000?"
      );
      console.error("SoundShape error", err);
    }
  }
  injectButton();
  var currentVideoId = getVideoId();
  function onVideoChange() {
    const vid = getVideoId();
    if (vid === currentVideoId) return;
    currentVideoId = vid;
    const wasActive = session !== null;
    if (session) {
      session.stop();
      session = null;
    }
    injectButton();
    const btn = document.getElementById(
      "soundshape-btn"
    );
    if (!btn) return;
    if (wasActive && vid) {
      btn.textContent = "\u2726 SoundShape \u2014 stop";
      void start(btn);
    } else {
      btn.textContent = "\u2726 SoundShape";
    }
  }
  document.addEventListener("yt-navigate-finish", onVideoChange);
  setInterval(onVideoChange, 1e3);
})();
