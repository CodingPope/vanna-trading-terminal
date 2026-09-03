import { useAppSelector } from '@/store/hooks';
import { selectStats, selectFeedSource } from '@/store/selectors';
import { Activity, Cpu, Wifi, Clock } from 'lucide-react';

const FEED = {
  connecting: { label: 'CONNECTING', dot: 'bg-vanna-gold animate-pulse', text: 'text-vanna-gold',
                hint: 'Looking for the market data service' },
  live:       { label: 'LIVE',       dot: 'bg-vanna-green animate-pulse', text: 'text-vanna-green',
                hint: 'Streaming from the market data service' },
  simulated:  { label: 'SIMULATED',  dot: 'bg-vanna-gold', text: 'text-vanna-gold',
                hint: 'No backend reachable — prices are generated in the browser' },
} as const;

/** US regular session, in Eastern time. */
function marketIsOpen(now: Date): boolean {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function StatsFooter() {
  const stats = useAppSelector(selectStats);
  const feedSource = useAppSelector(selectFeedSource);
  // Driven off the store's clock rather than Date.now(): it already ticks once
  // a second, and reading the wall clock during render is impure.
  const isOpen = marketIsOpen(new Date(stats.lastUpdate));

  return (
    <footer className="h-7 bg-vanna-surface/90 backdrop-blur-xl border-t border-white/5 flex items-center justify-between px-3 text-[10px] font-mono">
      {/* Left: Connection status */}
      <div className="flex items-center gap-4">
        {/* LIVE means a socket. The simulation is labelled as one rather than
            borrowing the word, which it did while showing no latency at all. */}
        <div className="flex items-center gap-1.5" title={FEED[feedSource].hint}>
          <div className={`w-2 h-2 rounded-full ${FEED[feedSource].dot}`} />
          <span className={FEED[feedSource].text}>{FEED[feedSource].label}</span>
        </div>
        
        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Wifi className="w-3 h-3" />
          {/* Only a real socket can measure latency; no socket, no number. */}
          <span title="WebSocket round-trip latency">
            {stats.wsLatency ? `${stats.wsLatency}ms` : '—'}
          </span>
        </div>
      </div>

      {/* Center: Market status */}
      {/* Was a hardcoded "MARKET OPEN", which said the same thing at 3am on a
          Sunday. Derived from the clock instead. */}
      <div className="hidden md:flex items-center gap-4 text-vanna-text-secondary">
        <span className={isOpen ? 'text-vanna-green' : undefined}>
          {isOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
        </span>
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
          {/* performance.memory is Chromium-only. */}
          <span title="JS heap in use">
            {stats.memoryUsage ? `${stats.memoryUsage}MB` : '—'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-vanna-text-secondary">
          <Clock className="w-3 h-3" />
          <span title="Longest frame in the last second">
            {stats.renderTime ? `${stats.renderTime}ms peak` : '—'}
          </span>
        </div>
        
        <div className="text-vanna-text-secondary">
          UPD: {new Date(stats.lastUpdate).toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>
    </footer>
  );
}
