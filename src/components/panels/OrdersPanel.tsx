import { useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { usePaperAction } from '@/hooks/usePaperAction';
import { useFeedHealth } from '@/hooks/useFeedHealth';
import type { PaperOrder } from '@/schemas/paper';

export function OrdersPanel() {
  const account = useAppSelector(s => s.paper.account);
  const synchronized = useAppSelector(s => s.paper.synchronized);
  const [tab, setTab] = useState<'orders' | 'executions'>('orders');
  const [editing, setEditing] = useState<PaperOrder | null>(null);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const { run, error, busy } = usePaperAction();
  const health = useFeedHealth();
  const active = account?.orders.filter(o => o.status === 'working' || o.status === 'partially_filled') ?? [];
  // Cancels remain available when market data is stale; HTTP is authoritative.
  const canCancel = health.source === 'live' && synchronized && !busy;
  return <div className="h-full flex flex-col min-h-0">
    <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-white/10">
      <div className="flex gap-2">{(['orders', 'executions'] as const).map(t => <button key={t} className="desk-button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'orders' ? `Orders (${account?.orders.length ?? 0})` : `Executions (${account?.executions.length ?? 0})`}</button>)}</div>
      <button className="desk-button text-red-300" disabled={!canCancel || !active.length} onClick={() => { if (window.confirm(`Cancel all ${active.length} working paper orders in this account?`)) void run('/cancel-all'); }}>Cancel all ({active.length})</button>
    </div>
    {error && <p role="alert" className="p-2 text-xs text-red-300">{error}</p>}
    {editing && <form aria-label="Amend order" className="flex flex-wrap items-end gap-2 p-2 bg-teal-950/30" onSubmit={e => { e.preventDefault(); void run(`/orders/${editing.id}`, 'PATCH', { version: editing.version, quantity: Number(quantity), limitPrice: Number(price) }).then(ok => { if (ok) setEditing(null); }); }}>
      <label className="desk-label">Total quantity<input className="desk-input w-28" aria-label="Amend total quantity" type="number" min={editing.filledQuantity + 1} step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
      <label className="desk-label">Limit price<input className="desk-input w-28" aria-label="Amend limit price" type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required /></label>
      <button className="desk-button" disabled={busy || !health.healthy}>Save amendment</button><button type="button" className="desk-button" onClick={() => setEditing(null)}>Close editor</button>
    </form>}
    <div className="flex-1 overflow-auto">
      {tab === 'orders' ? <table className="desk-table" aria-label="Paper orders"><thead><tr>{['Symbol', 'Side', 'Type / TIF', 'Qty / Filled', 'Limit / Avg', 'Status', 'Actions'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {account?.orders.map(o => <tr key={o.id} data-order-id={o.id}>
          <td className="font-semibold">{o.symbol}</td><td className={o.side === 'buy' ? 'text-green-300' : 'text-red-300'}>{o.side.toUpperCase()}</td>
          <td>{o.orderType} / {o.timeInForce}</td><td>{o.quantity} / {o.filledQuantity}</td><td>{o.limitPrice?.toFixed(2) ?? 'MKT'} / {o.averageFillPrice ? o.averageFillPrice.toFixed(2) : '—'}</td>
          <td><span>{o.status.replaceAll('_', ' ')}</span>{o.reason && <div className="text-vanna-text-secondary whitespace-normal max-w-52">{o.reason}</div>}</td>
          <td>{['working', 'partially_filled'].includes(o.status) && <div className="flex gap-1"><button className="desk-button" disabled={!canCancel} onClick={() => void run(`/orders/${o.id}`, 'DELETE')}>Cancel</button>{o.orderType === 'limit' && <button className="desk-button" disabled={!health.healthy || busy} onClick={() => { setEditing(o); setQuantity(String(o.quantity)); setPrice(String(o.limitPrice)); }}>Amend</button>}</div>}</td>
        </tr>)}
      </tbody></table> : <table className="desk-table" aria-label="Paper executions"><thead><tr>{['Time', 'Symbol', 'Side', 'Quantity', 'Price', 'Fee'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{account?.executions.map(e => <tr key={e.id}><td>{new Date(e.timestamp).toLocaleTimeString()}</td><td>{e.symbol}</td><td>{e.side.toUpperCase()}</td><td>{e.quantity}</td><td>{e.price.toFixed(2)}</td><td>${e.fee.toFixed(2)}</td></tr>)}</tbody></table>}
      {!account?.orders.length && <p className="p-6 text-sm text-vanna-text-secondary">Your paper account starts flat. Submit an order to follow its lifecycle here.</p>}
    </div>
    <p className="px-3 py-1 text-[11px] text-vanna-text-secondary border-t border-white/10">{synchronized ? 'Account reconciled' : 'Awaiting account snapshot'} · revision {account?.revision ?? '—'} · In-memory demo account</p>
  </div>;
}
