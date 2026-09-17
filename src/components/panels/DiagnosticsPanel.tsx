import { useAppSelector } from '@/store/hooks';
import { usePaperAction } from '@/hooks/usePaperAction';
import { useFeedHealth } from '@/hooks/useFeedHealth';
import { runFeedScenario } from '@/services/feedControl';

export function DiagnosticsPanel() {
  const d = useAppSelector(s => s.market.diagnostics);
  const symbol = useAppSelector(s => s.market.selectedSymbol);
  const account = useAppSelector(s => s.paper.account);
  const { run, busy, error } = usePaperAction();
  const health = useFeedHealth();
  return <div className="p-3 space-y-3 h-full overflow-auto">
    <p className="text-xs text-vanna-text-secondary">Scenarios affect this connection and paper account. Market data is synthetic or reconstructed replay.</p>
    <div className="flex flex-wrap gap-2">{(['disconnect', 'gap', 'stale', 'invalid', 'burst'] as const).map(action => <button key={action} className="desk-button" disabled={!health.connected || health.source !== 'live'} onClick={() => runFeedScenario(action, symbol)}>{({ disconnect: 'Disconnect feed', gap: 'Skip book sequence', stale: 'Stall feed 6s', invalid: 'Invalid payload', burst: 'Burst 1,000 quotes' })[action]}</button>)}</div>
    <dl className="grid grid-cols-3 gap-3 text-xs">{Object.entries(d).map(([key, value]) => <div key={key}><dt className="text-vanna-text-secondary">{key}</dt><dd className="font-mono" data-metric={key}>{value}</dd></div>)}</dl>
    <p className="text-[11px] text-vanna-text-secondary">Processing time is the last queue drain in milliseconds, excluding paint. Received counts decoded feed envelopes and expanded burst quotes. Drops describe display-feed shedding, never executions.</p>
    <div className="flex gap-2 flex-wrap">
      <button className="desk-button" disabled={busy || !account} onClick={() => void run('/control', 'POST', { action: account?.paused ? 'resume' : 'pause' })}>{account?.paused ? 'Resume paper fills' : 'Pause paper fills'}</button>
      <button className="desk-button text-amber-300" disabled={busy || !account} onClick={() => { if (window.confirm('Reset this paper account? This removes its orders, fills, and positions.')) void run('/control', 'POST', { action: 'reset' }); }}>Reset paper account</button>
    </div>
    {account?.paused && <p role="status" className="text-xs text-amber-300">Paper matching paused. Orders remain working until resumed or canceled.</p>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
