import { useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { receiveAccount } from '@/store/slices/paperSlice';
import { submitPaperOrder, paperRequest } from '@/services/paper';
import type { OrderDraft } from '@/schemas/paper';
import { useFeedHealth } from '@/hooks/useFeedHealth';

export function OrderEntryPanel() {
  const symbol = useAppSelector(s => s.market.selectedSymbol);
  return <Ticket key={symbol} symbol={symbol} />;
}
function Ticket({ symbol }: { symbol: string }) {
  const quote = useAppSelector(s => s.market.entities[symbol]);
  const synchronized = useAppSelector(s => s.paper.synchronized);
  const health = useFeedHealth();
  const dispatch = useAppDispatch();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [quantity, setQuantity] = useState('100');
  const [price, setPrice] = useState(() => (quote?.ask ?? 0).toFixed(2));
  const [tif, setTif] = useState<'GTC' | 'IOC'>('GTC');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState<OrderDraft | null>(null);
  const submitting = useRef(false);
  const amount = Number(quantity);
  const orderPrice = orderType === 'limit' ? Number(price) : (side === 'buy' ? quote?.ask : quote?.bid) ?? 0;
  const notional = amount * orderPrice;
  const valid = Number.isInteger(amount) && amount > 0 && amount <= 10000 && orderPrice > 0
    && Math.abs(orderPrice * 100 - Math.round(orderPrice * 100)) < 1e-6 && notional <= 50000 && symbol !== 'VIX';
  const ready = health.healthy && synchronized;

  async function submit() {
    if (submitting.current || !ready || (!uncertain && !valid)) return;
    const draft: OrderDraft = uncertain ?? { clientOrderId: crypto.randomUUID(), symbol, side, orderType,
      quantity: amount, limitPrice: orderType === 'limit' ? Number(price) : null, timeInForce: tif };
    submitting.current = true; setBusy(true); setMessage('Submitting paper order…');
    try {
      const account = await submitPaperOrder(draft);
      dispatch(receiveAccount(account));
      const order = account.orders.find(o => o.clientOrderId === draft.clientOrderId);
      setMessage(order?.status === 'rejected' ? `Rejected: ${order.reason}` : `Acknowledged · ${draft.side.toUpperCase()} ${draft.quantity} ${draft.symbol}`);
      setUncertain(null);
    } catch (e) {
      // A timeout is an unknown outcome. Keep the same immutable request ID
      // until the server acknowledges it; never turn a retry into a new order.
      try {
        const account = await paperRequest();
        dispatch(receiveAccount(account));
        const found = account.orders.find(o => o.clientOrderId === draft.clientOrderId);
        if (found) { setMessage(`Reconciled · ${found.status.replaceAll('_', ' ')}`); setUncertain(null); }
        else { setUncertain(draft); setMessage(`${e instanceof Error ? e.message : 'Acknowledgement missing'} Retry checks the same order ID.`); }
      } catch { setUncertain(draft); setMessage('Acknowledgement unknown. Reconnect, then retry the same request.'); }
    } finally { submitting.current = false; setBusy(false); }
  }
  return <form className="p-3 flex flex-col gap-3 h-full overflow-auto" onSubmit={e => { e.preventDefault(); void submit(); }} aria-label="Paper order ticket">
    <div className="flex justify-between items-center"><strong className="font-mono text-lg">{symbol}</strong><span className="text-xs text-vanna-gold">PAPER · USD</span></div>
    <fieldset disabled={busy || Boolean(uncertain)} className="space-y-3 disabled:opacity-60">
      <div className="grid grid-cols-2 gap-2">
        {(['buy', 'sell'] as const).map(s => <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={`desk-button ${side === s ? s === 'buy' ? 'bg-emerald-950 text-emerald-300 border-emerald-500' : 'bg-red-950 text-red-300 border-red-500' : ''}`}>{s.toUpperCase()}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="desk-label">Order type<select value={orderType} onChange={e => setOrderType(e.target.value as typeof orderType)} className="desk-input"><option value="limit">Limit</option><option value="market">Market</option></select></label>
        <label className="desk-label">Quantity<input className="desk-input" type="number" min="1" max="10000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
      </div>
      {orderType === 'limit' && <label className="desk-label">Limit price<input className="desk-input" type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required /></label>}
      <div className="flex gap-2 text-xs"><button type="button" className="desk-button flex-1" onClick={() => setPrice((quote?.bid ?? 0).toFixed(2))}>Bid {quote?.bid.toFixed(2)}</button><button type="button" className="desk-button flex-1" onClick={() => setPrice((quote?.ask ?? 0).toFixed(2))}>Ask {quote?.ask.toFixed(2)}</button></div>
      <label className="desk-label">Time in force<select className="desk-input" value={tif} onChange={e => setTif(e.target.value as typeof tif)}><option value="GTC">GTC · until canceled</option><option value="IOC">IOC · one fill attempt</option></select></label>
    </fieldset>
    <div className="flex justify-between text-xs"><span>Estimated notional</span><strong className="font-mono">${Number.isFinite(notional) ? notional.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</strong></div>
    {notional > 50000 && <p className="text-xs text-red-300">Maximum order notional is $50,000.</p>}
    {!ready && <p role="status" className="text-xs text-amber-300">Order entry paused · {health.status.toLowerCase()}{health.healthy ? ' · reconciling account' : ''}</p>}
    <button type="submit" className="desk-button bg-teal-900 text-teal-100" disabled={busy || !ready || (!uncertain && !valid)}>{busy ? 'Awaiting acknowledgement…' : uncertain ? 'Retry same request' : 'Submit paper order'}</button>
    <p className="text-xs text-vanna-text-secondary">25 shares per fill · $0.005/share · Market orders have a 1% price collar. No real money.</p>
    {message && <p role="status" className="text-xs text-vanna-cyan">{message}</p>}
  </form>;
}
