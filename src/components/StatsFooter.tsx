import { useAppSelector } from '@/store/hooks';
import { selectStats, selectIsConnected } from '@/store/selectors';
import { Activity, Cpu, Wifi, Clock } from 'lucide-react';

export function StatsFooter() {
  const stats = useAppSelector(selectStats);
  const isConnected = useAppSelector(selectIsConnected);

  return (
    <footer className="h-7 bg-vanna-surface/90 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-3 text-[10px] font-mono">
      {/* Left: Connection status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-vanna-green animate-pulse' : 'bg-vanna-red'}`} />
          <span className={isConnected ? 'text-vanna-green' : 'text-vanna-red'}>
            {isConnected ? 'LIVE' : 'DISCONNECTED'}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Wifi className="w-3 h-3" />
          <span>{stats.wsLatency}ms</span>
        </div>
      </div>

      {/* Center: Market status */}
      <div className="hidden md:flex items-center gap-4 text-vanna-text-secondary">
        <span>MARKET OPEN</span>
        <span className="text-vanna-gold">09:30 - 16:00 ET</span>
      </div>

      {/* Right: Performance stats */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Activity className="w-3 h-3" />
          <span>{stats.fps} FPS</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Cpu className="w-3 h-3" />
          <span>{stats.memoryUsage}MB</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Clock className="w-3 h-3" />
          <span>{stats.renderTime}ms</span>
        </div>
        
        <div className="text-vanna-text-secondary">
          UPD: {new Date(stats.lastUpdate).toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
    </footer>
  );
}
