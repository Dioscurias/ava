"use client";

import {useEffect, useRef, useState} from "react";

const vertex = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 resolution;
uniform float time;
uniform float voice;
uniform float rippleProgress;
uniform vec3 rippleOrigin;

mat2 rotate(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

float field(vec3 p) {
  float ridge = 0.0;
  float frequency = 3.0;
  float amplitude = 0.095 + voice * 0.085;
  vec3 q = p;
  q.xz = rotate(time * 0.24) * q.xz;
  // Each octave folds and rotates the surface into smaller ridges.
  for (int i = 0; i < 4; i++) {
    float fold = sin(q.x * frequency + sin(q.y * frequency + time)
      + cos(q.z * frequency));
    ridge += amplitude * (sqrt(fold * fold + 0.027) - 0.52);
    q = sqrt(q.yzx * q.yzx + 0.007);
    frequency *= 2.0;
    amplitude *= 0.52;
  }
  float wave = sin(p.y * 7.0 - time * 3.0) * voice * 0.08;
  // Expand a pair of damped rings from the point on the shell under the cursor.
  float ripple = 0.0;
  if (rippleProgress > 0.0 && rippleProgress < 1.0) {
    float distanceFromOrigin = length(normalize(p) - rippleOrigin);
    float front = distanceFromOrigin - rippleProgress * 1.85;
    float envelope = exp(-front * front * 42.0)
      * smoothstep(0.0, 0.10, rippleProgress) * (1.0 - smoothstep(0.37, 1.0, rippleProgress));
    ripple = cos(front * 17.0) * envelope * 0.065;
  }
  return length(p) - (0.74 + voice * 0.13 + wave + ridge + ripple);
}

float mineral(vec3 p) {
  vec3 q = p * 7.0;
  q.xz = rotate(time * 0.24) * q.xz;
  float cloud = sin(q.x + sin(q.z * 1.8)) * sin(q.y * 1.25);
  float grain = sin(q.x * 4.3 + q.y) * sin(q.y * 3.2 + q.z * 2.1);
  float vein = pow(0.5 + 0.5 * sin(4.0 * q.y + 2.5 * sin(q.x) + 0.7 * sin(q.z * 4.0)), 18.0);
  return clamp(0.48 + cloud * 0.26 + grain * 0.07 + vein * 0.16, 0.0, 1.0);
}

float softbox(vec3 reflection, vec3 position, float width, float height) {
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), position));
  vec3 up = cross(position, right);
  vec2 offset = vec2(dot(reflection, right), dot(reflection, up));
  vec2 edge = smoothstep(vec2(width, height) * 0.7, vec2(width, height), abs(offset));
  return (1.0 - edge.x) * (1.0 - edge.y) * smoothstep(0.45, 0.88, dot(reflection, position));
}

vec3 jade(vec3 p, vec3 n, vec3 view) {
#ifdef CHAMBER_LIGHT
  // Match the chamber photograph: one tall window and weak floor bounce.
  vec3 windowLight = normalize(vec3(-0.66, 0.73, 0.27));
  vec3 floorBounce = normalize(vec3(0.0, -1.0, 0.22));
  vec3 reflection = reflect(-view, n);
  float nv = max(0.0, dot(n, view));
  float fresnel = 0.045 + 0.955 * pow(1.0 - nv, 5.0);
  float key = max(0.0, dot(n, windowLight));
  float bounce = max(0.0, dot(n, floorBounce));
  float relief = clamp(-field(p - n * 0.055) / 0.05, 0.12, 1.0);
  vec3 stone = mix(vec3(0.006, 0.029, 0.018), vec3(0.032, 0.16, 0.086), mineral(p));
  vec3 color = stone * (0.14 + key * 1.18 + bounce * 0.16) * (0.34 + 0.66 * relief);
  float window = softbox(reflection, windowLight, 0.14, 0.43);
  color += vec3(0.74, 0.79, 0.77) * window * (0.21 + fresnel * 0.33);
  color += vec3(0.020, 0.029, 0.027) * fresnel * (0.28 + key * 0.72);
  color += vec3(0.013, 0.062, 0.027) * pow(1.0 - nv, 2.0) * key;
  return pow(1.0 - exp(-color * 1.12), vec3(1.0 / 2.2));
#else
  vec3 key = normalize(vec3(-0.54, 0.72, 0.58));
  vec3 strip = normalize(vec3(0.71, 0.12, 0.72));
  vec3 reflection = reflect(-view, n);
  float nv = max(0.0, dot(n, view));
  float fresnel = 0.045 + 0.955 * pow(1.0 - nv, 5.0);
  float diffuse = max(0.0, dot(n, key));
  float relief = clamp(-field(p - n * 0.055) / 0.05, 0.15, 1.0);
  float translucence = pow(1.0 - nv, 2.0) * (0.22 + 0.78 * diffuse);
  float pattern = mineral(p);
  vec3 stone = mix(vec3(0.034, 0.42, 0.12), vec3(0.20, 1.72, 0.49), pattern);
  vec3 lighting = stone * (0.39 + 0.95 * diffuse + 0.24 * max(0.0, dot(n, strip))) * (0.5 + 0.5 * relief);
  lighting += vec3(0.055, 0.44, 0.22) * translucence;
  float panels = 1.15 * softbox(reflection, key, 0.44, 0.25)
    + 0.48 * softbox(reflection, strip, 0.11, 0.57);
  float polish = pow(max(0.0, dot(n, normalize(view + key))), 38.0);
  lighting += vec3(0.86, 0.98, 0.94) * (panels * (0.20 + fresnel) + polish * 0.09);
  lighting += vec3(0.10, 0.20, 0.15) * fresnel;
  return pow(1.0 - exp(-lighting * 1.18), vec3(1.0 / 2.2));
#endif
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution) / resolution.y;
  vec3 origin = vec3(0.0, 0.0, 2.8);
  vec3 direction = normalize(vec3(uv, -2.3));
  // Skip pixels outside a sphere that encloses the fully expanded surface.
  float depth = dot(origin, direction);
  float discriminant = depth * depth - dot(origin, origin) + 1.16 * 1.16;
  if (discriminant < 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float extent = sqrt(discriminant);
  float travel = -depth - extent;
  float farEdge = -depth + extent;
#ifdef CHAMBER_LIGHT
  const int maxSteps = 96;
  float hitThreshold = 0.0028;
#else
  const int maxSteps = 52;
  float hitThreshold = 0.002;
#endif
  for (int i = 0; i < maxSteps; i++) {
    vec3 p = origin + travel * direction;
    float d = field(p);
    if (d < hitThreshold) {
      vec2 e = vec2(0.0035, 0.0);
      vec3 n = normalize(vec3(field(p + e.xyy) - field(p - e.xyy),
        field(p + e.yxy) - field(p - e.yxy), field(p + e.yyx) - field(p - e.yyx)));
      gl_FragColor = vec4(jade(p, n, -direction), 1.0);
      return;
    }
    travel += max(d * 0.49, 0.0015);
    if (travel > farEdge) break;
  }
  gl_FragColor = vec4(0.0);
}
`;

export function VoiceOrb({listening, large = false, processing = false, chamberLight = false}: {listening: boolean; large?: boolean; processing?: boolean; chamberLight?: boolean}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const level = useRef(0);
  const listeningRef = useRef(listening);
  const processingStart = useRef<number | null>(null);
  const hover = useRef({start: -Infinity, x: 0, y: 0, z: 1});
  const [rendered, setRendered] = useState(false);

  useEffect(() => {listeningRef.current = listening;}, [listening]);
  useEffect(() => {processingStart.current = processing ? performance.now() : null;}, [processing]);

  useEffect(() => {
    if (!listening || !navigator.mediaDevices?.getUserMedia) return;
    let closed = false;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    let frame = 0;

    void (async () => {
      try {
        const input = await navigator.mediaDevices.getUserMedia({audio: true});
        if (closed) {input.getTracks().forEach(track => track.stop()); return;}
        stream = input;
        context = new AudioContext();
        await context.resume();
        if (closed) return;
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const sample = () => {
          analyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const value of samples) energy += value * value;
          const rms = Math.sqrt(energy / samples.length);
          const target = Math.max(0, Math.min(1, (rms - 0.012) * 9));
          level.current += (target - level.current) * 0.2;
          frame = requestAnimationFrame(sample);
        };
        sample();
      } catch {
        stream?.getTracks().forEach(track => track.stop());
        if (context && context.state !== "closed") void context.close().catch(() => {});
      }
    })();

    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
      if (context && context.state !== "closed") void context.close().catch(() => {});
      level.current = 0;
    };
  }, [listening]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {alpha: true, antialias: false});
    if (!canvas || !gl) return;
    function compile(gpu: WebGLRenderingContext, type: number, source: string) {
      const shader = gpu.createShader(type);
      if (!shader) return null;
      gpu.shaderSource(shader, source);
      gpu.compileShader(shader);
      if (gpu.getShaderParameter(shader, gpu.COMPILE_STATUS)) return shader;
      gpu.deleteShader(shader);
      return null;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, vertex);
    const fs = compile(gl, gl.FRAGMENT_SHADER, chamberLight ? "#define CHAMBER_LIGHT\n" + fragment : fragment);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const dispose = () => {
      gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program); gl.deleteBuffer(buffer);
    };
    if (!vs || !fs || !program || !buffer) {dispose(); return;}
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {dispose(); return;}
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "resolution");
    const time = gl.getUniformLocation(program, "time");
    const voice = gl.getUniformLocation(program, "voice");
    const rippleProgress = gl.getUniformLocation(program, "rippleProgress");
    const rippleOrigin = gl.getUniformLocation(program, "rippleOrigin");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");

    let frame = 0;
    let previous = -Infinity;
    const draw = (now: number) => {
      if (now - previous >= 32) {
        previous = now;
        gl.uniform1f(time, motion.matches ? 0 : now * 0.001 % 600);
        const start = processingStart.current;
        const pulse = start === null ? 0 : Math.sin(Math.PI * Math.min(1, Math.max(0, now - start) / 420));
        const microphone = listeningRef.current ? 0.14 + level.current * 0.86 : 0;
        gl.uniform1f(voice, motion.matches ? 0 : Math.max(microphone, pulse * 0.85));
        const ripple = hover.current;
        gl.uniform1f(rippleProgress, motion.matches ? 0 : Math.min(1, Math.max(0, (now - ripple.start) / 1050)));
        gl.uniform3f(rippleOrigin, ripple.x, ripple.y, ripple.z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    };
    const restart = () => {cancelAnimationFrame(frame); previous = -Infinity; draw(performance.now());};
    const resize = () => {
      const density = Math.min(2, Math.max(1.4, window.devicePixelRatio));
      const pixels = large ? Math.min(880, Math.max(352, Math.round(canvas.clientWidth * density))) : 144;
      canvas.width = pixels;
      canvas.height = pixels;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      restart();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", restart);
    resize();
    setRendered(true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", restart);
      dispose();
    };
  }, [large, chamberLight]);

  function rippleAtPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!large || event.pointerType === "touch") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.x - bounds.width / 2) / (bounds.width * 0.36);
    const y = (bounds.y + bounds.height / 2 - event.clientY) / (bounds.height * 0.36);
    const radius = x * x + y * y;
    if (radius > 1) return;
    const now = performance.now();
    const previous = hover.current;
    if (event.type === "pointermove" && Number.isFinite(previous.start)) {
      if (now - previous.start < 720 || Math.hypot(x - previous.x, y - previous.y) < 0.22) return;
    }
    hover.current = {start: now, x, y, z: Math.sqrt(1 - radius)};
  }

  return <div className={large ? "voice-orb voice-orb-large" : "voice-orb"} data-rendered={rendered} aria-hidden="true"
    onPointerEnter={rippleAtPointer} onPointerMove={rippleAtPointer}>
    <canvas ref={canvasRef} width={large ? 352 : 144} height={large ? 352 : 144}/>
  </div>;
}
