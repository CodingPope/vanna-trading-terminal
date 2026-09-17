import type { PaperAccount } from '@/schemas/paper';
import type { MarketData } from '@/types';

export function accountRisk(account: PaperAccount, quotes: Record<string, MarketData>) {
  let unrealized = 0, gross = 0, net = 0;
  const positions = account.positions.map(p => {
    const mark = quotes[p.symbol]?.price ?? p.averageCost;
    const pnl = (mark - p.averageCost) * p.quantity;
    unrealized += pnl;
    gross += Math.abs(p.quantity * mark);
    net += p.quantity * mark;
    return { ...p, mark, pnl };
  });
  const pnl = account.realizedPnl + unrealized - account.fees;
  return { positions, unrealized, gross, net, pnl, equity: account.initialCash + pnl,
    returnPercent: pnl / account.initialCash * 100 };
}
