import { useAppSelector } from '@/store/hooks';
import { accountRisk } from '@/lib/paperRisk';
import { useFeedHealth } from '@/hooks/useFeedHealth';
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export function PositionsPanel() {
  const account = useAppSelector(s => s.paper.account);
  const quotes = useAppSelector(s => s.market.entities);
  const health = useFeedHealth();
  if (!account) return <p className="p-4 text-sm text-vanna-text-secondary">Waiting for your paper account. Start the API to enable execution.</p>;
  const risk = accountRisk(account, quotes);
  return <div className="h-full overflow-auto p-3 space-y-3">
    <div className="flex justify-between"><div><p className="desk-label">Net P&amp;L · after fees</p><strong className={`text-xl font-mono ${risk.pnl >= 0 ? 'text-green-300' : 'text-red-300'}`}>{usd(risk.pnl)}</strong></div><span className="text-xs text-vanna-text-secondary">{risk.returnPercent.toFixed(2)}%<br />of $100k initial equity</span></div>
    {!health.healthy && <p role="status" className="text-xs text-amber-300">Marks may be stale · {health.status.toLowerCase()}</p>}
    <dl className="grid grid-cols-2 gap-2 text-xs">{[['Realized', account.realizedPnl], ['Unrealized', risk.unrealized], ['Gross exposure', risk.gross], ['Net exposure', risk.net], ['Fees', account.fees], ['Equity', risk.equity]].map(([label, value]) => <div key={label}><dt className="text-vanna-text-secondary">{label}</dt><dd className="font-mono">{usd(Number(value))}</dd></div>)}</dl>
    <table className="desk-table" aria-label="Paper positions"><thead><tr><th>Symbol</th><th>Shares</th><th>Avg cost</th><th>P&amp;L</th></tr></thead><tbody>{risk.positions.map(p => <tr key={p.symbol}><td>{p.symbol}</td><td>{p.quantity}</td><td>{p.averageCost.toFixed(2)}</td><td className={p.pnl >= 0 ? 'text-green-300' : 'text-red-300'}>{usd(p.pnl)}</td></tr>)}</tbody></table>
    {!risk.positions.length && <p className="text-xs text-vanna-text-secondary">No open positions. Filled orders update this account.</p>}
    <p className="text-[11px] text-vanna-text-secondary">USD · average cost · marks at last price. Gross limit $250k including working orders.</p>
  </div>;
}
