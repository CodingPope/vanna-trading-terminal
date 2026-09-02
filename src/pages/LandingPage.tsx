import { useState } from 'react';
import { DisplacementOrb } from '@/components/DisplacementOrb';
import { useUI } from '@/store';
import { Sparkles } from 'lucide-react';

export function LandingPage() {
  const { state, enterDashboard } = useUI();
  const [particles] = useState(() =>
    Array.from({ length: 24 }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: 5 + Math.random() * 10,
      delay: Math.random() * 5,
      opacity: 0.35 + Math.random() * 0.3,
    }))
  );

  return (
    <div 
      className="relative min-h-screen w-full flex flex-col items-center justify-center overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 20%, #101323 0%, #060711 55%, #03040a 100%)' }}
    >
      {/* Background vignette */}
      <div className="absolute inset-0 vignette pointer-events-none" />

      {/* Floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-vanna-gold/40"
            style={{
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              animation: `float ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
              opacity: particle.opacity,
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-4 pb-16">
        {/* Title */}
        <div className="text-center space-y-2">
          <h1 
            className="text-6xl md:text-8xl font-bold tracking-tight"
            style={{ 
              fontFamily: 'Inter, sans-serif',
              color: '#e0e0ff',
              textShadow: '0 0 40px rgba(255, 221, 136, 0.3)',
            }}
          >
            VANNA
          </h1>
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-vanna-gold/60" />
            <p className="terminal-text text-vanna-text-secondary tracking-widest">
              γ PERIPHERAL MARKET AWARENESS
            </p>
            <Sparkles className="w-4 h-4 text-vanna-gold/60" />
          </div>
        </div>

        {/* 3D Displacement Orb */}
        <div className="py-6">
          <DisplacementOrb size={360} />
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={enterDashboard}
            className="px-6 py-3 rounded-full border border-vanna-gold/30 bg-white/5 text-sm tracking-[0.2em] text-vanna-text-secondary hover:text-white hover:border-vanna-gold/60 transition-all duration-200 backdrop-blur"
          >
            ENTER TERMINAL
          </button>
          <p className="terminal-text text-vanna-text-secondary/60 text-[10px] tracking-wider">
            INSTITUTIONAL GRADE MARKET INTELLIGENCE
          </p>
        </div>
      </div>

      {/* Loading overlay */}
      {state.isLoading && (
        <div className="absolute inset-0 bg-vanna-bg/90 backdrop-blur-xl z-50 flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-2 border-vanna-gold/20 border-t-vanna-gold animate-spin" />
          </div>
          <p className="mt-6 terminal-text text-vanna-text-secondary animate-pulse">
            {state.loadingMessage}
          </p>
        </div>
      )}
    </div>
  );
}
