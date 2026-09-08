// Framework-agnostic WebGL renderer for the SoundShape emotion field.
//
// No React, no DOM framework — just a canvas + WebGL. Used by both the web
// app (via the EmotionCanvas React wrapper) and the Chrome extension's content
// script, so the visuals are guaranteed identical everywhere.
//
// Usage:
//   const field = createEmotionField(canvas, { transparent: true });
//   field.setVisual(visualSpec);   // update target each frame/segment
//   field.pulse();                 // flash on a segment/emotion change
//   field.destroy();               // on teardown
//
// The field eases its uniforms toward the latest visual for continuous
// morphing; a domain-warped fbm shader contained in a soft organic silhouette
// produces the molten / OLED-wallpaper look (see EmotionCanvas docs).

export interface VisualColor {
  h: number;
  s: number;
  l: number;
}
export interface VisualMotion {
  type: string;
  amplitude: number;
  speed: number;
}
export interface FieldVisual {
  shape: string;
  color: VisualColor;
  size: number;
  motion: VisualMotion;
  /**
   * How unsure the classifier was, 0 (confident) to 1 (no idea).
   *
   * Kept separate from colour on purpose. In hybrid rendering saturation
   * already means measured arousal, so dimming it for low confidence made a
   * calm voice and an unsure guess look identical — the viewer could not tell
   * which they were seeing.
   */
  uncertainty?: number;
}

export interface EmotionFieldHandle {
  setVisual(visual: FieldVisual): void;
  setTransparent(transparent: boolean): void;
  pulse(strength?: number): void;
  destroy(): void;
  /**
   * Copy the next rendered frame into a detached canvas, for report figures.
   *
   * The WebGL context is created without `preserveDrawingBuffer`, so reading
   * the canvas from outside the render loop — drawImage, toDataURL — returns
   * an empty buffer: by then the frame has been composited and discarded.
   * Capture therefore has to happen inside the loop, immediately after the
   * draw call, which is what this schedules. Resolves null on the renderers
   * that have no shader output to read.
   */
  capture(): Promise<HTMLCanvasElement | null>;
  /**
   * Which renderer is actually running.
   *
   * "webgl" draws the full glyph — shape, turbulence, motion. "fallback-2d"
   * draws a coloured radial glow and nothing else: no shape, no movement. That
   * is fine for conveying emotion over a video, where colour still carries the
   * message, but it is NOT interchangeable for anything that measures whether
   * a viewer can read shape or motion — those channels are simply absent.
   * Callers that measure must check this and refuse rather than record noise.
   */
  readonly renderer: "webgl" | "fallback-2d" | "none";
}

interface Uniforms {
  unsure: number;
  sharp: number;
  hue: number;
  sat: number;
  light: number;
  turb: number;
  flow: number;
  contrast: number;
  bright: number;
  edgeTurb: number;
  edgeFreq: number;
  breathe: number;
  elong: number;
}

const FALLBACK_BG =
  "radial-gradient(circle at 50% 45%, hsl(265 50% 22%), #050507 70%)";

export function createEmotionField(
  canvas: HTMLCanvasElement,
  opts: { transparent?: boolean } = {},
): EmotionFieldHandle {
  let transparent = !!opts.transparent;
  let visual: FieldVisual = {
    shape: "simple_circle",
    color: { h: 0, s: 0, l: 55 },
    size: 0.5,
    motion: { type: "still", amplitude: 0, speed: 0 },
  };
  let burst = 0;
  let raf: number | null = null;
  let pendingCapture: ((c: HTMLCanvasElement) => void) | null = null;

  // Canvas-2D fallback: when WebGL is unavailable or the shader won't compile
  // (some GPUs/drivers — notably macOS ANGLE under context pressure — reject it
  // or lose the context), still show the emotion as a colored radial glow that
  // tracks hue / size / pulse. No fractal detail, but the right color and
  // motion — so the demo works on any browser instead of a black box.
  function start2DFallback(): EmotionFieldHandle {
    // The passed canvas already owns a WebGL context (now lost), and a canvas
    // can hold only one context type — getContext("2d") on it returns null.
    // So draw on a fresh sibling canvas that occupies the same box, and hide
    // the dead WebGL one.
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

    const dpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      1.5,
    );
    const resize = () => {
      const rect = c2.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (w === c2.width && h === c2.height) return;
      c2.width = w;
      c2.height = h;
    };
    resize();
    window.addEventListener("resize", resize);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => resize())
        : null;
    ro?.observe(c2);

    const cur = uniformsFor(visual);
    const draw = () => {
      if (c2.width <= 1 || c2.height <= 1) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const t = uniformsFor(visual);
      const ease = 0.08;
      cur.hue = lerpHue(cur.hue, t.hue, ease);
      cur.sat += (t.sat - cur.sat) * ease;
      cur.light += (t.light - cur.light) * ease;
      cur.bright += (t.bright - cur.bright) * ease;
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
      // Bigger, stronger glow so it reads clearly over a video (the fractal
      // detail needs WebGL; here we prioritize an unmistakable colored presence).
      const R = Math.min(W, H) * (0.42 + 0.14 * cur.bright) * (1 + 0.18 * burst);
      const hue = Math.round(cur.hue);
      const sat = Math.round(Math.max(0.35, Math.min(1, cur.sat)) * 100);
      const light = Math.round(
        Math.max(0, Math.min(1, cur.light * 0.6 + 0.3)) * 100,
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
      // The fallback draws a coloured glow and nothing else, so a capture of it
      // would look like a finished figure while silently omitting shape and
      // motion. Refuse rather than hand back a misleading image.
      capture: async () => null,
      setVisual(v: FieldVisual) {
        visual = v;
      },
      setTransparent(x: boolean) {
        transparent = x;
      },
      pulse(strength = 0.45) {
        burst = Math.min(1.4, burst + strength);
      },
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        ro?.disconnect();
        window.removeEventListener("resize", resize);
        c2.remove();
        canvas.style.visibility = "";
      },
    };
  }

  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    powerPreference: "high-performance",
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
    gl.STATIC_DRAW,
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
    unsure: gl.getUniformLocation(program, "u_unsure"),
  };

  const dpr = Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    1.5,
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
  // The canvas often has no layout yet when the field is constructed (the
  // extension appends its overlay and calls this synchronously), and YouTube
  // resizes the player without firing a window 'resize' (theater / fullscreen).
  // Observe the element directly so the backing buffer always tracks its real
  // size — otherwise a 1×1 buffer gets stretched into a solid opaque bar.
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => resize())
      : null;
  ro?.observe(canvas);

  const cur = uniformsFor(visual);
  let lastT = performance.now();
  const start = lastT;

  const render = (now: number) => {
    // Skip while the canvas has no real size — drawing a degenerate buffer
    // stretches one region's color across the whole element (the "white bar").
    if (canvas.width <= 1 || canvas.height <= 1) {
      raf = requestAnimationFrame(render);
      return;
    }
    const dt = Math.min(0.05, (now - lastT) / 1000);
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
    gl.uniform1f(U.time, (now - start) / 1000);
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

    if (pendingCapture) {
      const done = pendingCapture;
      pendingCapture = null;
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      out.getContext("2d")?.drawImage(canvas, 0, 0);
      done(out);
    }

    raf = requestAnimationFrame(render);
  };
  raf = requestAnimationFrame(render);

  return {
    renderer: "webgl",
    capture() {
      return new Promise((resolve) => {
        pendingCapture = resolve;
      });
    },
    setVisual(v: FieldVisual) {
      visual = v;
    },
    setTransparent(t: boolean) {
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
      // Deliberately NOT calling WEBGL_lose_context.loseContext() here.
      //
      // loseContext() does not just free the context, it poisons the CANVAS:
      // a later getContext() on the same element returns that same lost object
      // rather than a new one, and every shader compile against it fails with
      // `contextLost: true`. Any remount of the same canvas — which React does
      // on every StrictMode double-invoke, and whenever a component re-renders
      // in place — then silently drops to the 2D fallback. That was the cause
      // of the blank/white field, and the fallback below was only hiding it.
      //
      // Dropping the references is enough; the browser reclaims the context
      // when the canvas is collected. Measured on this machine: 24 concurrent
      // contexts available, against the 1-3 this app ever holds.
    },
  };
}

function noopHandle(): EmotionFieldHandle {
  return {
    renderer: "none",
    capture: async () => null,
    setVisual() {},
    setTransparent() {},
    pulse() {},
    destroy() {},
  };
}

// How angular the waveform is for each shape the mapping can produce.
//
// This is where the `shape` channel finally reaches the screen. It used to be
// computed, displayed in the readout and cited in the write-up while the
// renderer ignored it entirely — the glyph switched on motion type alone. A
// waveform has no outline to be star-shaped, but it does have a slope, and
// angular-versus-rounded survives that translation: the same research that
// says jagged forms read as threatening and round ones as warm (Aronoff et al.
// 1992; Bar & Neta 2006) is about contour sharpness, which is exactly what a
// peak's steepness is.
const SHARPNESS_BY_SHAPE: Record<string, number> = {
  jagged_star: 1.0,        // anger, sarcasm
  trembling_spikes: 0.92,  // fear
  expanding_burst: 0.55,   // joy, surprise
  simple_circle: 0.4,      // neutral
  flowing_wave: 0.18,      // sadness
  drooping_ellipse: 0.12,  // resignation
  soft_circle: 0.05,       // sincerity
};

// ── emotion (VisualSpec) → shader uniform targets ──

function uniformsFor(v: FieldVisual): Uniforms {
  const m = v.motion;
  let turb: number;
  let contrast: number;
  let edgeTurb: number;
  let edgeFreq: number;
  let breathe: number;
  let elong: number;
  switch (m.type) {
    case "shake": // anger
      turb = 0.95; contrast = 0.9; edgeTurb = 0.85; edgeFreq = 7; breathe = 0.35; elong = 1.05;
      break;
    case "tremor": // fear
      turb = 1.0; contrast = 0.8; edgeTurb = 0.95; edgeFreq = 9; breathe = 0.3; elong = 1.0;
      break;
    case "pulse": // joy / surprise
      turb = 0.5; contrast = 0.55; edgeTurb = 0.45; edgeFreq = 5; breathe = 0.85; elong = 1.05;
      break;
    case "slow_drift": // sadness
      turb = 0.28; contrast = 0.32; edgeTurb = 0.2; edgeFreq = 2; breathe = 0.25; elong = 1.4;
      break;
    case "sink": // resignation
      turb = 0.3; contrast = 0.3; edgeTurb = 0.22; edgeFreq = 2; breathe = 0.2; elong = 1.5;
      break;
    default: // still — neutral / sincerity
      turb = 0.2; contrast = 0.35; edgeTurb = 0.15; edgeFreq = 3; breathe = 0.35; elong = 1.1;
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
    elong,
  };
}

// ── WebGL shader source + helpers ──

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `
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
// The band reads as SOUND at a glance, which a radial glow never did — and in
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
//   k > 1  the curve hugs zero then rises late  → a narrow, pointed peak
//   k < 1  it rises immediately and flattens    → a broad, blunt one
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
  // instability — a shaky voice gets needles, a steady one gets broad swells —
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
  // Lightness has to stay well short of white or the hue — the one channel
  // carrying which emotion this is — disappears into the blowout.
  float light = clamp(u_light * 0.52 + vis * 0.22 * u_bright, 0.03, 0.72);
  vec3 field = hsl2rgb(vec3(hue, clamp(u_sat,0.0,1.0), light));
  // A highlight only in the very core of the band, not across the body.
  field += pow(vis, 7.0) * u_bright * 0.22;

  // Doubt lowers presence. The form keeps its outline and its size — those are
  // measurements and they are not in question — and simply asserts itself less.
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

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // A null info log with a failed compile almost always means the context was
    // lost (GPU reset / too many live contexts) rather than a source error —
    // surface which one so the failure is actionable instead of "null".
    const log = gl.getShaderInfoLog(sh);
    // eslint-disable-next-line no-console
    console.error(
      "SoundShape shader compile failed:",
      log && log.trim() ? log : "(no log)",
      "| contextLost:",
      gl.isContextLost(),
      "| glError:",
      gl.getError(),
    );
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("SoundShape program link error:", gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function shortHue(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}
function lerpHue(a: number, b: number, k: number): number {
  return (a + shortHue(a, b) * k + 360) % 360;
}
