import { useRef, useEffect, useState, useCallback } from 'react';
import { useUI } from '@/store';

interface OrbProps {
  size?: number;
  className?: string;
}

export function Orb({ size = 120, className = '' }: OrbProps) {
  const { state, dispatch, enterDashboard } = useUI();
  const orbRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [marketRegime, setMarketRegime] = useState<'neutral' | 'bullish' | 'bearish'>('neutral');
  const [particles] = useState(() =>
    Array.from({ length: 12 }, () => ({
      opacity: 0.3 + Math.random() * 0.4,
      left: 50 + (Math.random() - 0.5) * 80,
      top: 50 + (Math.random() - 0.5) * 80,
      duration: 4 + Math.random() * 4,
    }))
  );

  // Simulate market regime changes
  useEffect(() => {
    const interval = setInterval(() => {
      const regimes: ('neutral' | 'bullish' | 'bearish')[] = ['neutral', 'bullish', 'bearish'];
      const weights = [0.6, 0.25, 0.15];
      const random = Math.random();
      let cumulative = 0;
      for (let i = 0; i < regimes.length; i++) {
        cumulative += weights[i];
        if (random <= cumulative) {
          setMarketRegime(regimes[i]);
          break;
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Mouse tracking for magnetic effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) / 20;
      const deltaY = (e.clientY - centerY) / 20;
      setMousePos({ x: deltaX, y: deltaY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Long press handling
  const startPress = useCallback(() => {
    dispatch({ type: 'SET_ORB_PRESSED', payload: true });
    let progress = 0;
    
    progressIntervalRef.current = setInterval(() => {
      progress += 2;
      dispatch({ type: 'SET_ORB_PRESS_PROGRESS', payload: progress });
      
      if (progress >= 100) {
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
        dispatch({ type: 'SET_ORB_PRESSED', payload: false });
        dispatch({ type: 'SET_ORB_PRESS_PROGRESS', payload: 0 });
        enterDashboard();
      }
    }, 20);
  }, [dispatch, enterDashboard]);

  const endPress = useCallback(() => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    dispatch({ type: 'SET_ORB_PRESSED', payload: false });
    dispatch({ type: 'SET_ORB_PRESS_PROGRESS', payload: 0 });
  }, [dispatch]);

  // Get orb colors based on market regime
  const getOrbColors = () => {
    switch (marketRegime) {
      case 'bullish':
        return {
          core: '#22c55e',
          edge: '#16a34a',
          glow: 'rgba(34, 197, 94, 0.5)',
          inner: 'rgba(34, 197, 94, 0.3)',
        };
      case 'bearish':
        return {
          core: '#ef4444',
          edge: '#dc2626',
          glow: 'rgba(239, 68, 68, 0.5)',
          inner: 'rgba(239, 68, 68, 0.3)',
        };
      default:
        return {
          core: '#ffdd88',
          edge: '#b8a060',
          glow: 'rgba(255, 221, 136, 0.5)',
          inner: 'rgba(255, 221, 136, 0.3)',
        };
    }
  };

  const colors = getOrbColors();

  return (
    <div 
      ref={containerRef}
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size * 2, height: size * 2 }}
    >
      {/* Particle effects */}
      <div className="absolute inset-0 pointer-events-none">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{
              background: colors.core,
              opacity: particle.opacity,
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animation: `float ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </div>

      {/* Outer glow rings */}
      <div 
        className="absolute rounded-full pointer-events-none"
        style={{
          width: size * 2.5,
          height: size * 2.5,
          background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
          animation: 'orb-breathe 4s ease-in-out infinite',
        }}
      />
      
      <div 
        className="absolute rounded-full pointer-events-none"
        style={{
          width: size * 2,
          height: size * 2,
          background: `radial-gradient(circle, ${colors.inner} 0%, transparent 60%)`,
          animation: 'orb-breathe 4s ease-in-out infinite',
          animationDelay: '0.5s',
        }}
      />

      {/* Main orb */}
      <div
        ref={orbRef}
        className="relative rounded-full cursor-pointer select-none transition-transform duration-100"
        style={{
          width: size,
          height: size,
          transform: isHovering 
            ? `translate(${mousePos.x}px, ${mousePos.y}px) scale(${1 + state.orbPressProgress * 0.002})`
            : `scale(${1 + state.orbPressProgress * 0.002})`,
          background: `radial-gradient(circle at 30% 30%, ${colors.core} 0%, ${colors.edge} 50%, #1a1a1f 100%)`,
          boxShadow: `
            0 0 ${30 + state.orbPressProgress * 0.3}px ${colors.glow},
            0 0 ${60 + state.orbPressProgress * 0.5}px ${colors.inner},
            inset 0 0 ${30}px ${colors.inner},
            inset -10px -10px 30px rgba(0,0,0,0.5)
          `,
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false);
          endPress();
        }}
        onMouseDown={startPress}
        onMouseUp={endPress}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        role="button"
        aria-label="Enter trading dashboard - long press to activate"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            enterDashboard();
          }
        }}
      >
        {/* Inner sphere effect */}
        <div 
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.3) 0%, transparent 40%)`,
          }}
        />
        
        {/* Surface texture - noise pattern simulation */}
        <div 
          className="absolute inset-0 rounded-full opacity-30"
          style={{
            background: `
              repeating-conic-gradient(
                from 0deg at 50% 50%,
                transparent 0deg,
                rgba(255,255,255,0.03) 5deg,
                transparent 10deg
              )
            `,
          }}
        />

        {/* Progress ring for long press */}
        {state.orbPressed && (
          <svg 
            className="absolute -inset-4 pointer-events-none"
            style={{ width: size + 32, height: size + 32 }}
          >
            <circle
              cx={(size + 32) / 2}
              cy={(size + 32) / 2}
              r={(size + 16) / 2}
              fill="none"
              stroke={colors.core}
              strokeWidth="2"
              strokeDasharray={`${2 * Math.PI * (size + 16) / 2}`}
              strokeDashoffset={`${2 * Math.PI * (size + 16) / 2 * (1 - state.orbPressProgress / 100)}`}
              strokeLinecap="round"
              style={{
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
                transition: 'stroke-dashoffset 0.02s linear',
              }}
            />
          </svg>
        )}
      </div>

      {/* Press hint */}
      <div 
        className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-center transition-opacity duration-300"
        style={{ opacity: isHovering ? 1 : 0.6 }}
      >
        <span className="terminal-text text-vanna-text-secondary">
          {state.orbPressed ? 'HOLD TO ENTER...' : 'LONG-PRESS THE ORB TO ENTER'}
        </span>
      </div>
    </div>
  );
}

// Small orb indicator for dashboard header
export function OrbIndicator({ size = 40 }: { size?: number }) {
  const [marketRegime, setMarketRegime] = useState<'neutral' | 'bullish' | 'bearish'>('neutral');

  useEffect(() => {
    const interval = setInterval(() => {
      const regimes: ('neutral' | 'bullish' | 'bearish')[] = ['neutral', 'bullish', 'bearish'];
      setMarketRegime(regimes[Math.floor(Math.random() * regimes.length)]);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const getColor = () => {
    switch (marketRegime) {
      case 'bullish': return '#22c55e';
      case 'bearish': return '#ef4444';
      default: return '#ffdd88';
    }
  };

  return (
    <div 
      className="relative rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 30%, ${getColor()} 0%, ${getColor()}80 50%, transparent 100%)`,
        boxShadow: `0 0 ${size/2}px ${getColor()}60`,
        animation: 'orb-breathe 4s ease-in-out infinite',
      }}
    >
      <div 
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.4) 0%, transparent 40%)`,
        }}
      />
    </div>
  );
}
