import { useState } from 'react';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { useUIStore } from '@/store/uiStore';

export function FocusListPanel() {
  const quotes = useAppSelector(s => s.market.entities);
  const selected = useAppSelector(s => s.market.selectedSymbol);
  const { setSelectedSymbol, addAlert } = useMarketActions();
  const [filter, setFilter] = useState('');
  const [dismissed, setDismissed] = useState<string[]>([]);
  const symbols = Object.keys(quotes).filter(s => !dismissed.includes(s) && s.includes(filter.toUpperCase())).slice(0, 12);
  const notify = useUIStore(s => s.addNotification);
  function alert(symbol: string) {
    const value = window.prompt(`Alert price for ${symbol}`, quotes[symbol]?.price.toFixed(2));
    if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
    addAlert({ symbol, price: Number(value) });
    notify({ type: 'info', message: `Price-crossing alert set: ${symbol} $${Number(value).toFixed(2)}` });
  }
  return <div className="h-full flex flex-col" tabIndex={0} aria-label="Focus list navigation" onKeyDown={e => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const index = symbols.indexOf(selected);
    if (e.key === 'j' || e.key === 'k') { e.preventDefault(); const next = symbols[Math.max(0, Math.min(symbols.length - 1, index + (e.key === 'j' ? 1 : -1)))]; if (next) setSelectedSymbol(next); }
    if (e.key === 'a' && quotes[selected]) { e.preventDefault(); alert(selected); }
    if (e.key === 'd') { e.preventDefault(); setDismissed(s => [...s, selected]); }
    if (e.key === ' ') { e.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="Paper order ticket"] input')?.focus(); }
  }}>
    <div className="p-2"><input aria-label="Filter focus list" className="desk-input" placeholder="Filter symbols…" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    <div className="flex-1 overflow-auto">{symbols.map(s => <div key={s} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 text-xs"><button className="font-mono" aria-pressed={selected === s} onClick={() => setSelectedSymbol(s)}>{s}</button><span>{quotes[s].price.toFixed(2)}</span><button className="desk-button" onClick={() => alert(s)}>Alert</button></div>)}</div>
    <p className="p-2 text-[11px] text-vanna-text-secondary">Watch universe · J/K select, A alert, D dismiss while focused</p>
  </div>;
}
