/**
 * DisplacementOrb — React Three Fiber + post-processing rewrite.
 *
 * Preserves the original vertex displacement shaders, fragment aurora effect,
 * and market-regime-driven uniforms with OrbitControls.
 * The OrbIndicator (header) stays as raw Three.js (tiny canvas).
 */
import { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, AdaptiveDpr, Preload, Stats } from '@react-three/drei';
import * as THREE from 'three';
import { useUIStore } from '@/store/uiStore';
import { useAppSelector } from '@/store/hooks';
import { selectMarketPulse } from '@/store/selectors';
import { normalise, PULSE_SCALE } from '@/lib/marketPulse';
import { useOrbStore } from '@/store/orbStore';

// ── Shaders (identical to original, ported as tagged-template constants) ─────

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform float uDispersion;
  uniform float uBreadth;
  uniform float uPulse;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    // Breadth sets spatial frequency: a broad tape gives fine detail all over
    // the surface, narrow leadership gives a few large lobes.
    // Kept near 1 deliberately. The third octave samples at ~4x this, and on a
    // 128-segment sphere anything much higher aliases between vertices — it
    // reads as noise rather than as detail.
    float frequency = mix(0.85, 1.6, uBreadth);
    vec3 p = position * frequency;
    float n1 = snoise(p + uTime * 0.18);
    float n2 = snoise(p * 2.4 + uTime * 0.3);
    float n3 = snoise(p * 4.2 + uTime * 0.42);
    float noise = (n1 * 0.55 + n2 * 0.3 + n3 * 0.15) * 1.35;

    // Dispersion sets amplitude. Displacement from a sphere *is* deviation
    // from the mean, so the geometry is the statistic rather than a decoration
    // laid over it: names moving together leave the sphere smooth, names
    // pulling apart deform it.
    // Floor near zero so lockstep genuinely looks like a sphere: dispersion
    // has to be the dominant term or the shape stops carrying the meaning.
    float displacementAmount = 0.012 + uDispersion * 0.34 + uPulse * 0.012;
    vec3 displaced = position + normal * noise * displacementAmount;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uTrend;
  uniform float uVolatility;
  uniform float uPulse;

  vec3 hueShift(vec3 color, float shift) {
    const mat3 m = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114);
    vec3 lum = m * color;
    vec3 blend = color - lum;
    float angle = shift * 6.28318530718;
    vec3 shifted = lum + blend * cos(angle) + cross(vec3(1.0,1.0,1.0), blend) * sin(angle);
    return clamp(shifted, 0.0, 1.0);
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - dot(viewDir, normalize(vNormal)), 3.2);
    float swirl = sin(dot(normalize(vPosition), vec3(1.1,1.3,0.9)) * 4.0 + uTime * 1.2);
    float band = sin(vPosition.y * 3.0 + uTime * 1.5 + swirl * 1.5) * 0.5 + 0.5;
    vec3 baseA = vec3(0.24, 0.45, 1.0);
    vec3 baseB = vec3(0.78, 0.30, 0.98);
    vec3 baseC = vec3(0.98, 0.78, 0.42);
    vec3 core = mix(baseA, baseB, band);
    core = mix(core, baseC, fresnel * 0.75);
    // Direction reads green/red, which a trader parses pre-cognitively. A hue
    // rotation — what this did before — communicates nothing on its own.
    vec3 bull = vec3(0.18, 0.92, 0.60);
    vec3 bear = vec3(1.00, 0.30, 0.32);
    vec3 directional = mix(bear, bull, clamp(uTrend * 0.5 + 0.5, 0.0, 1.0));
    core = mix(core, directional, abs(uTrend) * 0.85);
    // Volatility only intensifies; it no longer decides the colour.
    core = mix(core, core * 1.35, uVolatility * 0.5);
    core = hueShift(core, uPulse * 0.04);
    vec3 glow = core * (0.65 + fresnel * 1.25);

    // Rim and bloom both used to be fixed colours — a blue rim plus a white
    // centre wash — which washed the directional tint straight back out. At
    // the centre fresnel is 0 and bloom is 1, so the result was core * 0.65
    // + 0.4 regardless of which way the market was going. Both now carry the
    // direction, so the whole sphere reads green or red at a glance.
    vec3 rim = mix(vec3(0.15, 0.25, 0.45), directional * 0.7, abs(uTrend));
    glow += rim * fresnel;
    float bloom = pow(max(dot(normalize(vNormal), viewDir), 0.0), 8.0);
    vec3 bloomTint = mix(vec3(1.0), directional, abs(uTrend) * 0.9);
    vec3 finalColor = glow + bloom * 0.4 * bloomTint;
    gl_FragColor = vec4(finalColor, 0.96);
  }
`;

// ── OrbMesh — the animated sphere inside a R3F scene ─────────────────────────
function OrbMesh({
  dispersion,
  volatility,
  trend,
  breadth,
}: {
  /** 0..1 — how far names deviate from the average move. Drives shape. */
  dispersion: number;
  /** 0..1 — how much is happening. Drives how fast the surface churns. */
  volatility: number;
  /** -1..1 — which way the market leans. Drives colour. */
  trend: number;
  /** 0..1 — share of names advancing. Drives detail frequency. */
  breadth: number;
}) {
  // "use no memo" opts this component out of the React Compiler.
  // R3F requires imperative uniform mutation every frame — the compiler's
  // immutability and ref-during-render rules are incompatible with that pattern.
  "use no memo";

  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { autoRotate } = useOrbStore();

  // Stable uniforms object — created once, mutated imperatively in useFrame/useEffect.
  const uniformsRef = useRef({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x6366f1) },
    uTrend: { value: trend },
    uDispersion: { value: dispersion },
    uVolatility: { value: volatility },
    uBreadth: { value: breadth },
    uPulse: { value: 0 },
  });


  useFrame((_, delta) => {
    if (!matRef.current || !meshRef.current) return;
    // Market values are written here rather than in an effect. useFrame reads
    // current props through the closure every frame, so there is no question
    // of whether a ref was attached or an effect had run — which is what left
    // uTrend sitting at its initial value while the market moved.
    const u = matRef.current.uniforms;
    u.uDispersion.value = dispersion;
    u.uVolatility.value = volatility;
    u.uTrend.value = trend;
    u.uBreadth.value = breadth;

    // Volatility drives the clock. This is the channel a person notices first
    // and nothing was using it — the surface churned at a fixed rate whatever
    // the market did. A quiet tape now barely moves; a violent one boils.
    const churn = 0.25 + volatility * 1.9;
    u.uTime.value += delta * churn;
    u.uPulse.value = Math.sin(u.uTime.value * 0.8) * 0.5 + 0.5;

    if (autoRotate) {
      meshRef.current.rotation.x += delta * 0.18;
      meshRef.current.rotation.y += delta * 0.36;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 128, 128]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        // eslint-disable-next-line react-hooks/refs
        uniforms={uniformsRef.current}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Main DisplacementOrb ──────────────────────────────────────────────────────
interface DisplacementOrbProps {
  size?: number;
  className?: string;
}

export function DisplacementOrb({ size = 400, className = '' }: DisplacementOrbProps) {
  const enterDashboard = useUIStore(s => s.enterDashboard);
  const pulse = useAppSelector(selectMarketPulse);

  // Continuous, not bucketed. This previously read the three-value regime enum
  // and mapped it to a handful of constants, so the orb had 27 possible
  // appearances in total and looked frozen even as prices moved.
  const { dispersion, volatility, trend, breadth } = useMemo(() => ({
    dispersion: normalise(pulse.dispersion, PULSE_SCALE.dispersion),
    volatility: normalise(pulse.volatility, PULSE_SCALE.volatility),
    // Signed: the shader needs to know direction, not just magnitude.
    trend: Math.sign(pulse.trend) * normalise(pulse.trend, PULSE_SCALE.trend),
    breadth: pulse.breadth,
  }), [pulse]);

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Outer CSS glow — cheap, no GPU overhead */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(73,119,255,0.25) 0%, rgba(120,58,240,0.18) 40%, transparent 70%)',
          filter: 'blur(12px)',
          animation: 'orb-breathe 4s ease-in-out infinite',
        }}
      />

      {/* R3F Canvas */}
      <Canvas
        style={{ width: size, height: size, cursor: 'pointer' }}
        gl={{ alpha: true, antialias: true }}
        camera={{ fov: 60, position: [0, 0, 3.2] }}
        onPointerDown={() => enterDashboard()}
        aria-label="Enter trading dashboard — click to proceed"
        role="button"
      >
        <AdaptiveDpr pixelated />
        <Preload all />

        <OrbMesh
          dispersion={dispersion}
          volatility={volatility}
          trend={trend}
          breadth={breadth}
        />

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate={false} // managed by OrbMesh via useOrbStore
          makeDefault
        />

        {import.meta.env.DEV && <Stats />}
      </Canvas>

      {/* Enter hint */}
      <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <span className="terminal-text text-vanna-text-secondary text-xs tracking-[0.2em]">
          TAP THE ORB TO ENTER
        </span>
      </div>
    </div>
  );
}

// ── OrbIndicator — small 40px header orb (stays raw Three.js — minimal overhead) ──
export function OrbIndicator({ size = 40 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const pulse = useAppSelector(selectMarketPulse);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 2;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const geometry = new THREE.IcosahedronGeometry(0.6, 32);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x6366f1) },
        uTrend: { value: 0 },
        uDispersion: { value: 0 },
        uVolatility: { value: 0 },
        uBreadth: { value: 0.5 },
        uPulse: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    materialRef.current = material;
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      material.uniforms.uTime.value += 0.015;
      material.uniforms.uPulse.value = Math.sin(material.uniforms.uTime.value) * 0.5 + 0.5;
      mesh.rotation.y += 0.008;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [size]);

  // Same four readings as the large orb. This is the one that actually earns
  // the "peripheral awareness" claim — it sits in the header while you work,
  // where the landing page orb is a splash screen you see once.
  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.uDispersion.value = normalise(pulse.dispersion, PULSE_SCALE.dispersion);
    u.uVolatility.value = normalise(pulse.volatility, PULSE_SCALE.volatility);
    u.uTrend.value = Math.sign(pulse.trend) * normalise(pulse.trend, PULSE_SCALE.trend);
    u.uBreadth.value = pulse.breadth;
  }, [pulse]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
