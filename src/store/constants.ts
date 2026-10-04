import type { TradingPhase } from '@/types';

export const TRADING_PHASES: TradingPhase[] = [
  { id: 'pre-market', name: 'PRE-MARKET', description: 'Scanner results & preparation', startTime: '04:00', endTime: '09:30', maxFocusItems: 12 },
  { id: 'open', name: 'OPEN', description: 'Top 3 names only - execution mode', startTime: '09:30', endTime: '11:00', maxFocusItems: 3 },
  { id: 'midday', name: 'MIDDAY', description: 'Position management & monitoring', startTime: '11:00', endTime: '15:00', maxFocusItems: 6 },
  { id: 'power-hour', name: 'POWER HOUR', description: 'Reversion & continuation plays', startTime: '15:00', endTime: '16:00', maxFocusItems: 5 },
];
