import { useAppSelector } from '@/store/hooks';
import { useFeedHealth } from '@/hooks/useFeedHealth';
export function StatsFooter() {
  const stats = useAppSelector(s => s.market.stats);
  const health = useFeedHealth();
  return <footer className="min-h-8 bg-vanna-surface border-t border-white/10 flex flex-wrap items-center justify-between gap-x-4 px-3 text-[11px] font-mono">
    <div className="flex gap-3"><span className="text-vanna-gold">PAPER · {health.source === 'simulated' ? 'SIMULATED' : health.mode.toUpperCase()}</span><span data-testid="feed-status" className={health.healthy ? 'text-green-300' : 'text-amber-300'}>{health.status}</span></div>
    <span className="text-vanna-text-secondary">Quote received {health.received ? new Date(health.received).toLocaleTimeString('en-US', { hour12: false }) : '—'}</span>
    <div className="flex gap-3 text-vanna-text-secondary"><span title="WebSocket round-trip latency">{health.connected && stats.wsLatency ? `${stats.wsLatency}ms RTT` : '—'}</span><span>{stats.fps} FPS</span><span title="Longest frame interval in the last second">{stats.renderTime}ms peak</span><span title="JS heap in use">{stats.memoryUsage || '—'} MB</span></div>
  </footer>;
}
