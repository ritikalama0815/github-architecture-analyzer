import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { Renderer, Program, Mesh, Triangle } from 'ogl';

export type MoltenMetalColorMode = 'molten' | 'ember' | 'frost';

type MoltenMetalCtx = {
  renderer: InstanceType<typeof Renderer>;
  program: InstanceType<typeof Program>;
  mesh: InstanceType<typeof Mesh>;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
};

const colorModeToFloat = (mode: MoltenMetalColorMode): number =>
  mode === 'ember' ? 1 : mode === 'frost' ? 2 : 0;

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uScale;
uniform float uDetail;
uniform float uGlow;
uniform float uCoreSize;
uniform float uSwirl;
uniform float uFold;
uniform float uBlackPoint;
uniform float uBrightness;
uniform float uColorMode;
uniform float uGrain;
uniform float uGrainIntensity;
uniform float uOpacity;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform bool uEnableMouse;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float time = iTime * uSpeed;
  vec2 p = uScale * ((gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y) - 0.5;

  vec2 drift = vec2(0.0);
  if (uEnableMouse) {
    drift = (uMouse - 0.5) * uMouseStrength * 2.0;
  }
  p += drift;

  vec2 i = p;
  float c = 0.0;
  float r = length(p + vec2(sin(time), sin(time * 0.3 + 5.0)) * 0.5);
  float d = length(p);
  float rot = d + time + p.x * uSwirl;

  float cosRot = cos(rot);
  mat2 warp = mat2(cos(rot - sin(time / 5.0)), sin(rot), -sin(cosRot - time), cosRot) * uFold;
  float glowCore = uGlow * uCoreSize;

  for (float n = 0.0; n < 8.0; n++) {
    if (n >= uDetail) break;
    p *= warp;
    float t = r - time / (n + 3.0);
    i -= p + vec2(cos(t - i.x - r) + sin(t + i.y), sin(t - i.y) + cos(t + i.x) + r);
    c += glowCore / length(vec2(sin(i.x + t), cos(i.y + t)));
  }

  c /= 6.0;

  float intensity = max(c - uBlackPoint, 0.0) * uBrightness;

  float g = clamp(intensity, 0.0, 1.0);

  float mid = 0.5;
  if (uColorMode > 1.5) {
    mid = 0.65;
  } else if (uColorMode > 0.5) {
    mid = 0.35;
  }

  vec3 col = mix(uColor1, uColor2, smoothstep(0.0, mid, g));
  col = mix(col, uColor3, smoothstep(mid, 1.0, g));

  float a = g;
  if (uGrain > 0.5) {
    float gr = hash(gl_FragCoord.xy + iTime);
    a += (gr - 0.5) * uGrainIntensity;
  }
  a = clamp(a, 0.0, 1.0) * uOpacity;
  fragColor = vec4(col * a, a);
}
`;

@Component({
  selector: 'app-molten-metal',
  standalone: true,
  template: `<div #container [class]="'molten-metal-container' + (className() ? ' ' + className() : '')"></div>`,
  styleUrl: './molten-metal.css',
  host: { style: 'display: block; width: 100%; height: 100%' },
})
export class MoltenMetalComponent implements AfterViewInit, OnDestroy {
  readonly color1 = input('#5227FF');
  readonly color2 = input('#FF9FFC');
  readonly color3 = input('#FFFFFF');
  readonly speed = input(0.35);
  readonly scale = input(4);
  readonly detail = input(3);
  readonly glow = input(1.6);
  readonly coreSize = input(0.1);
  readonly swirl = input(1);
  readonly fold = input(-0.2);
  readonly blackPoint = input(0.05);
  readonly brightness = input(1.3);
  readonly colorMode = input<MoltenMetalColorMode>('molten');
  readonly grain = input(true);
  readonly grainIntensity = input(0.05);
  readonly mouseInteraction = input(true);
  readonly mouseStrength = input(0.3);
  readonly opacity = input(1.0);
  readonly className = input('');

  private readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private cleanup?: () => void;
  private ctx?: MoltenMetalCtx;

  constructor() {
    effect(() => {
      this.applyUniforms();
    });
  }

  ngAfterViewInit() {
    const container = this.containerRef().nativeElement;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: 0.35 },
        uScale: { value: 4 },
        uDetail: { value: 3 },
        uGlow: { value: 1.6 },
        uCoreSize: { value: 0.1 },
        uSwirl: { value: 1 },
        uFold: { value: -0.2 },
        uBlackPoint: { value: 0.05 },
        uBrightness: { value: 1.3 },
        uColorMode: { value: 0 },
        uGrain: { value: 1 },
        uGrainIntensity: { value: 0.05 },
        uOpacity: { value: 1.0 },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: 0.3 },
        uEnableMouse: { value: true },
        uColor1: { value: new Float32Array([1, 1, 1]) },
        uColor2: { value: new Float32Array([1, 1, 1]) },
        uColor3: { value: new Float32Array([1, 1, 1]) },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    this.ctx = { renderer, program, mesh };
    this.applyUniforms();

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const res = program.uniforms['iResolution'].value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    const targetMouse: [number, number] = [0.5, 0.5];
    const currentMouse: [number, number] = [0.5, 0.5];

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(rect.width, 1);
      const h = Math.max(rect.height, 1);
      targetMouse[0] = (e.clientX - rect.left) / w;
      targetMouse[1] = 1.0 - (e.clientY - rect.top) / h;
    };
    const handleMouseLeave = () => {
      targetMouse[0] = 0.5;
      targetMouse[1] = 0.5;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();

    const loop = (t: number) => {
      program.uniforms['iTime'].value = (t - t0) * 0.001;
      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      const m = program.uniforms['uMouse'].value as Float32Array;
      m[0] = currentMouse[0];
      m[1] = currentMouse[1];
      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        isVisible ? tryStart() : tryStop();
      },
      { threshold: 0 },
    );
    io.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? tryStart() : tryStop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    tryStart();

    this.cleanup = () => {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      this.ctx = undefined;
      try {
        container.removeChild(canvas);
      } catch {
        /* ignore */
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }

  ngOnDestroy() {
    this.cleanup?.();
  }

  private applyUniforms() {
    const ctx = this.ctx;
    if (!ctx) return;
    const u = ctx.program.uniforms;

    u['uSpeed'].value = this.speed();
    u['uScale'].value = this.scale();
    u['uDetail'].value = this.detail();
    u['uGlow'].value = this.glow();
    u['uCoreSize'].value = Math.max(this.coreSize(), 0.001);
    u['uSwirl'].value = this.swirl();
    u['uFold'].value = this.fold();
    u['uBlackPoint'].value = this.blackPoint();
    u['uBrightness'].value = this.brightness();
    u['uColorMode'].value = colorModeToFloat(this.colorMode());
    u['uGrain'].value = this.grain() ? 1 : 0;
    u['uGrainIntensity'].value = this.grainIntensity();
    u['uOpacity'].value = this.opacity();
    u['uMouseStrength'].value = this.mouseStrength();
    u['uEnableMouse'].value = this.mouseInteraction();

    const c1 = hexToRgb(this.color1());
    const c2 = hexToRgb(this.color2());
    const c3 = hexToRgb(this.color3());
    const uc1 = u['uColor1'].value as Float32Array;
    const uc2 = u['uColor2'].value as Float32Array;
    const uc3 = u['uColor3'].value as Float32Array;
    uc1[0] = c1[0];
    uc1[1] = c1[1];
    uc1[2] = c1[2];
    uc2[0] = c2[0];
    uc2[1] = c2[1];
    uc2[2] = c2[2];
    uc3[0] = c3[0];
    uc3[1] = c3[1];
    uc3[2] = c3[2];
  }
}
