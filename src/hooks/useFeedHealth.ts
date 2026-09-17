import { useAppSelector } from '@/store/hooks';
export function useFeedHealth() {
  const connected = useAppSelector(s => s.market.isConnected);
  const source = useAppSelector(s => s.market.feedSource);
  const mode = useAppSelector(s => s.market.sourceMode);
  const received = useAppSelector(s => s.market.lastReceivedAt);
  const now = useAppSelector(s => s.market.stats.lastUpdate);
  const recovering = useAppSelector(s => Object.values(s.orderBook.recovering).some(Boolean));
  const stale = !received || now - received > 2500;
  const healthy = source === 'live' && connected && !stale && !recovering;
  const status = source === 'connecting' ? 'CONNECTING' : source === 'simulated' ? 'LOCAL SIMULATION'
    : !connected ? 'DISCONNECTED' : stale ? 'STALE' : recovering ? 'RECOVERING' : 'CONNECTED';
  return { connected, source, mode, stale, healthy, status, received };
}
