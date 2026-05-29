"use client";

import { useEffect, useRef } from "react";
import type { MotionSpec, VisualSpec } from "@/types/emotion";

interface Props {
  visual: VisualSpec;
  // Bumped when the active segment changes — seeds a transition flash.
  changedAt: number;
  // When true, output per-pixel alpha so the field glows over a <video>.
  transparent?: boolean;
}

/**
 * Abstract atmospheric emotion field — a GPU fragment shader.
 *
 * Domain-warped fractal noise produces fluid, volumetric energy (molten-glass /
 * OLED-wallpaper aesthetic: no icons, no hard edges) — but that energy is
 * CONTAINED in a soft, organic silhouette so it reads as a form, not a
 * formless liquid. The silhouette's character varies by emotion:
 *   anger   → turbulent, roiling edge
 *   sadness → smooth, wide, slow pool
 *   joy     → blooming petal lobes
 *   fear    → trembling high-frequency edge
 *   calm    → near-perfect soft orb
 * Colour ← valence/category (grounded hue); motion ← turbulence/flow/contrast;
 * size ← arousal (energy/brightness). Uniforms ease for continuous morphing,
 * with a flash on large shifts.
 */
export function EmotionCanvas({ visual, changedAt, transparent = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const visualRef = useRef(visual);
  visualRef.current = visual;
  const burstRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      canvas.style.background =
        "radial-gradient(circle at 50% 45%, hsl(265 50% 22%), #050507 70%)";
      return;
    }

    const program = buildProgram(gl);
    if (!program) {
      canvas.style.background =
        "radial-gradient(circle at 50% 45%, hsl(265 50% 22%), #050507 70%)";
      return;
    }
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
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const cur = uniformsFor(visualRef.current);
    let lastT = performance.now();
    const start = lastT;

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const target = uniformsFor(visualRef.current);

      const burst = burstRef.current;
      burstRef.current *= Math.pow(0.05, dt);
      const ease = Math.min(0.9, 1 - Math.pow(0.25, dt) + Math.min(0.6, burst) * 0.08);

      cur.hue = lerpHue(cur.hue, target.hue, ease);
      cur.sat += (target.sat - cur.sat) * ease;
      cur.light += (target.light - cur.light) * ease;
      cur.turb += (target.turb - cur.turb) * ease;
      cur.flow += (target.flow - cur.flow) * ease;
      cur.contrast += (target.contrast - cur.contrast) * ease;
      cur.bright += (target.bright - cur.bright) * ease;
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
      gl.uniform1f(U.contrast, Math.min(1, cur.contrast + burst * 0.25));
      gl.uniform1f(U.bright, cur.bright + burst * 0.35);
      gl.uniform1f(U.spread, 0.13);
      gl.uniform1f(U.overlay, transparent ? 1 : 0);
      gl.uniform1f(U.edgeTurb, cur.edgeTurb);
      gl.uniform1f(U.edgeFreq, cur.edgeFreq);
      gl.uniform1f(U.breathe, cur.breathe + burst * 0.15);
      gl.uniform1f(U.elong, cur.elong);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteBuffer(buf);
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transparent]);

  useEffect(() => {
    burstRef.current = Math.min(1.4, burstRef.current + 0.45);
  }, [changedAt]);

  return (
    <canvas
      ref={canvasRef}
      className={transparent ? "h-full w-full" : "h-full w-full rounded-2xl bg-black"}
    />
  );
}

// ── emotion (VisualSpec) → shader uniform targets ──

interface Uniforms {
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

function uniformsFor(v: VisualSpec): Uniforms {
  const m: MotionSpec = v.motion;
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
  return {
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

// ── WebGL helpers ──

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
uniform float u_edgeTurb, u_edgeFreq, u_breathe, u_elong;

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

void main(){
  float aspect=u_res.x/u_res.y;
  vec2 p=(v_uv-0.5)*vec2(aspect,1.0)*2.4;
  float t=u_time*u_flow;

  // ---- interior energy (domain-warped fbm) ----
  float warp=1.0+u_turb*2.8;
  vec2 q=vec2(fbm(p+vec2(0.0,t*0.25)), fbm(p+vec2(5.2,1.3)-t*0.18));
  vec2 r=vec2(fbm(p+q*warp+vec2(1.7,9.2)+t*0.15),
              fbm(p+q*warp+vec2(8.3,2.8)-t*0.12));
  float f=fbm(p+r*(1.0+u_turb*3.2));
  f=clamp(0.5+0.75*f,0.0,1.0);
  f=pow(f, mix(1.7,0.55,u_contrast));

  // ---- soft organic silhouette (gives it a FORM) ----
  vec2 pe=p/vec2(u_elong,1.0);
  float ang=atan(pe.y,pe.x);
  float dist=length(pe);
  float lobes = sin(ang*u_edgeFreq + u_time*0.5)*0.6 + sin(ang*(u_edgeFreq*0.5) - u_time*0.3)*0.4;
  float edgeN = fbm(vec2(cos(ang),sin(ang))*2.2 + u_time*0.25); // turbulent boundary
  float R = 0.66
          * (1.0 + 0.07*u_breathe*sin(u_time*1.3))
          * (1.0 + 0.30*u_edgeTurb*lobes)
          + 0.16*u_edgeTurb*edgeN;
  float feather = 0.20 + 0.10*u_edgeTurb;
  float inside = smoothstep(R + feather, R - feather, dist);
  float glow = exp(-max(0.0, dist - R) * 3.2);   // soft outer bloom

  // ---- colour ----
  float hue=u_hue + (f-0.5)*u_spread + r.x*0.05;
  float light=clamp(u_light*0.55 + f*0.6*u_bright, 0.03, 0.96);
  vec3 field=hsl2rgb(vec3(hue, clamp(u_sat,0.0,1.0), light));
  field += pow(f,3.0)*u_bright*0.7;              // cinematic bloom cores

  float vis = clamp(inside + glow*0.55, 0.0, 1.0);

  if(u_overlay>0.5){
    // over video: only the form's energy is visible, edges fade out
    gl_FragColor = vec4(field, clamp(vis*u_bright*1.15, 0.0, 1.0));
  } else {
    vec3 bg = hsl2rgb(vec3(mod(u_hue,1.0), 0.4, 0.035));
    vec3 col = mix(bg, field, inside) + field*glow*0.5;
    gl_FragColor = vec4(col, 1.0);
  }
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.error("SoundShape shader compile error:", gl.getShaderInfoLog(sh));
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
