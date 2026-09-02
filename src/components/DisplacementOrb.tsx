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
import { useUI } from '@/store';
import { useAppSelector } from '@/store/hooks';
import { selectMarketRegime } from '@/store/selectors';
import { useOrbStore } from '@/store/orbStore';

// ── Shaders (identical to original, ported as tagged-template constants) ─────

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform float uVolatility;
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
    vec3 p = position * 1.1;
    float n1 = snoise(p + uTime * 0.18);
    float n2 = snoise(p * 2.4 + uTime * 0.3);
    float n3 = snoise(p * 4.2 + uTime * 0.42);
    float noise = (n1 * 0.55 + n2 * 0.3 + n3 * 0.15) * 1.35;
    float displacementAmount = 0.12 + uBreadth * 0.12 + uPulse * 0.06;
    vec3 displaced = position + normal * noise * displacementAmount;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uTrendStrength;
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
    core = mix(core, vec3(1.0, 0.35, 0.28), uVolatility * 0.45);
    core = hueShift(core, uTrendStrength * 0.1 + uPulse * 0.08);
    vec3 glow = core * (0.65 + fresnel * 1.25);
    glow += vec3(0.15, 0.25, 0.45) * fresnel;
    float bloom = pow(max(dot(normalize(vNormal), viewDir), 0.0), 8.0);
    vec3 finalColor = glow + bloom * 0.4;
    gl_FragColor = vec4(finalColor, 0.96);
  }
`;

// ── OrbMesh — the animated sphere inside a R3F scene ─────────────────────────
function OrbMesh({
  volatility,
  trendStrength,
  breadth,
}: {
  volatility: number;
  trendStrength: number;
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
    uTrendStrength: { value: trendStrength },
    uVolatility: { value: volatility },
    uBreadth: { value: breadth },
    uPulse: { value: 0 },
  });

  // Sync market-driven values when props change
  useEffect(() => {
    uniformsRef.current.uVolatility.value = volatility;
    uniformsRef.current.uTrendStrength.value = trendStrength;
    uniformsRef.current.uBreadth.value = breadth;
    if (matRef.current) {
      matRef.current.uniforms.uVolatility.value = volatility;
      matRef.current.uniforms.uTrendStrength.value = trendStrength;
      matRef.current.uniforms.uBreadth.value = breadth;
    }
  }, [volatility, trendStrength, breadth]);

  useFrame((_, delta) => {
    if (!matRef.current || !meshRef.current) return;
    matRef.current.uniforms.uTime.value += delta * 0.7;
    matRef.current.uniforms.uPulse.value =
      Math.sin(matRef.current.uniforms.uTime.value * 0.8) * 0.5 + 0.5;

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
  const { enterDashboard } = useUI();
  const marketRegime = useAppSelector(selectMarketRegime);

  const { volatility, trendStrength, breadth } = useMemo(() => {
    return {
      volatility: marketRegime.volatility === 'low' ? 0.2 : marketRegime.volatility === 'high' ? 0.95 : 0.5,
      trendStrength: marketRegime.trend === 'neutral' ? 0.3 : 0.8,
      breadth: marketRegime.breadth === 'strong' ? 0.85 : marketRegime.breadth === 'weak' ? 0.25 : 0.5,
    };
  }, [marketRegime]);

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

        <OrbMesh volatility={volatility} trendStrength={trendStrength} breadth={breadth} />

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
  const marketRegime = useAppSelector(selectMarketRegime);

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
        uTrendStrength: { value: 0.5 },
        uVolatility: { value: 0.5 },
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

  useEffect(() => {
    if (!materialRef.current) return;
    materialRef.current.uniforms.uVolatility.value =
      marketRegime.volatility === 'low' ? 0.2 : marketRegime.volatility === 'high' ? 0.95 : 0.5;
  }, [marketRegime]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
