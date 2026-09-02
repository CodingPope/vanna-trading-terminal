import { useDeferredValue } from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectFocusList, selectSelectedSymbol } from '@/store/selectors';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  Target,
  Shield,
  Zap,
  BarChart3
} from 'lucide-react';

interface AnaPanelProps {
  symbol?: string;
}

export function AnaPanel({ symbol: propSymbol }: AnaPanelProps) {
  const focusList = useAppSelector(selectFocusList);
  const selectedSymbol = useAppSelector(selectSelectedSymbol);
  const symbol = propSymbol || selectedSymbol;

  // Get focus item for this symbol
  const focusItem = focusList.find(item => item.symbol === symbol);
  const analysis = focusItem?.anaAnalysis;

  // useDeferredValue defers the re-render of the heavy analysis UI when the
  // selected symbol changes, keeping the rest of the dashboard responsive.
  const deferredAnalysis = useDeferredValue(analysis);
  const isStale = analysis !== deferredAnalysis;

  if (!deferredAnalysis) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-vanna-text-secondary p-4">
        <BarChart3 className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No ANA analysis available</p>
        <p className="text-xs mt-1">Select a symbol from the focus list</p>
      </div>
    );
  }

  const getVerdictConfig = () => {
    switch (deferredAnalysis.verdict) {
      case 'VALID':
        return {
          icon: CheckCircle2,
          color: 'text-vanna-green',
          bgColor: 'bg-vanna-green/10',
          borderColor: 'border-vanna-green/30',
          label: 'VALID SETUP',
        };
      case 'NO_TRADE':
        return {
          icon: XCircle,
          color: 'text-vanna-red',
          bgColor: 'bg-vanna-red/10',
          borderColor: 'border-vanna-red/30',
          label: 'NO TRADE',
        };
      case 'STANDBY':
        return {
          icon: AlertCircle,
          color: 'text-vanna-gold',
          bgColor: 'bg-vanna-gold/10',
          borderColor: 'border-vanna-gold/30',
          label: 'STANDBY',
        };
    }
  };

  const getSetupTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      breakout: 'BREAKOUT',
      pullback: 'PULLBACK',
      reversal: 'REVERSAL',
      continuation: 'CONTINUATION',
      range: 'RANGE BOUND',
    };
    return labels[type] || type.toUpperCase();
  };

  const getRegimeFitLabel = (fit: string) => {
    const labels: Record<string, { text: string; color: string }> = {
      strong: { text: 'STRONG', color: 'text-vanna-green' },
      moderate: { text: 'MODERATE', color: 'text-vanna-gold' },
      weak: { text: 'WEAK', color: 'text-vanna-red' },
    };
    return labels[fit] || { text: fit.toUpperCase(), color: 'text-vanna-text-secondary' };
  };

  const verdict = getVerdictConfig();
  const regimeFit = getRegimeFitLabel(deferredAnalysis.regimeFit);

  return (
    <div className={`h-full flex flex-col transition-opacity duration-150 ${isStale ? 'opacity-50' : 'opacity-100'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-vanna-cyan" />
          <span className="header-caps">ANA Analysis</span>
          {isStale && <span className="text-[9px] text-vanna-text-secondary animate-pulse">updating…</span>}
        </div>
        <span className="font-mono text-xs text-vanna-text-secondary">{symbol}</span>
      </div>

      {/* Verdict banner */}
      <div className={`px-3 py-3 border-b ${verdict.borderColor} ${verdict.bgColor}`}>
        <div className="flex items-center gap-3">
          <verdict.icon className={`w-8 h-8 ${verdict.color}`} />
          <div>
            <p className={`text-lg font-semibold ${verdict.color}`}>{verdict.label}</p>
            <p className="text-xs text-vanna-text-secondary">
              Confidence: {deferredAnalysis.confidence}%
            </p>
          </div>
        </div>
      </div>

      {/* Setup details */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Setup Type */}
        <div className="glass-panel p-3">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-vanna-cyan" />
            <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Setup Type</span>
          </div>
          <p className="font-mono text-lg text-vanna-text">
            {getSetupTypeLabel(deferredAnalysis.setupType)}
          </p>
        </div>

        {/* Price levels */}
        <div className="grid grid-cols-3 gap-2">
          <div className="glass-panel p-2">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-vanna-green" />
              <span className="text-[9px] text-vanna-text-secondary uppercase">Trigger</span>
            </div>
            <p className="font-mono text-sm text-vanna-green">
              ${deferredAnalysis.triggerPrice.toFixed(2)}
            </p>
          </div>
          
          <div className="glass-panel p-2">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="w-3 h-3 text-vanna-red" />
              <span className="text-[9px] text-vanna-text-secondary uppercase">Stop</span>
            </div>
            <p className="font-mono text-sm text-vanna-red">
              ${deferredAnalysis.invalidationLevel.toFixed(2)}
            </p>
          </div>
          
          <div className="glass-panel p-2">
            <div className="flex items-center gap-1 mb-1">
              <Target className="w-3 h-3 text-vanna-cyan" />
              <span className="text-[9px] text-vanna-text-secondary uppercase">Target</span>
            </div>
            <p className="font-mono text-sm text-vanna-cyan">
              ${deferredAnalysis.targetPrice.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Risk/Reward */}
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Risk/Reward Ratio</span>
            <span className={`font-mono text-xl font-semibold ${
              deferredAnalysis.riskRewardRatio >= 2 ? 'text-vanna-green' : 
              deferredAnalysis.riskRewardRatio >= 1 ? 'text-vanna-gold' : 'text-vanna-red'
            }`}>
              1:{deferredAnalysis.riskRewardRatio.toFixed(1)}
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-vanna-surface-light rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                deferredAnalysis.riskRewardRatio >= 2 ? 'bg-vanna-green' : 
                deferredAnalysis.riskRewardRatio >= 1 ? 'bg-vanna-gold' : 'bg-vanna-red'
              }`}
              style={{ width: `${Math.min(deferredAnalysis.riskRewardRatio / 3 * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Regime Fit */}
        <div className="glass-panel p-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Regime Fit</span>
            <span className={`font-mono text-sm ${regimeFit.color}`}>
              {regimeFit.text}
            </span>
          </div>
        </div>

        {/* Notes */}
        <div className="glass-panel p-3">
          <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Analysis Notes</span>
          <p className="text-xs text-vanna-text mt-1 leading-relaxed">
            {deferredAnalysis.notes}
          </p>
        </div>
      </div>

      {/* Action buttons */}
      {deferredAnalysis.verdict === 'VALID' && (
        <div className="px-3 py-3 border-t border-white/5 flex items-center gap-2">
          <button className="flex-1 px-4 py-2 bg-vanna-green/20 border border-vanna-green/40 rounded text-vanna-green text-sm font-medium hover:bg-vanna-green/30 transition-colors">
            Stage Long
          </button>
          <button className="flex-1 px-4 py-2 bg-vanna-red/20 border border-vanna-red/40 rounded text-vanna-red text-sm font-medium hover:bg-vanna-red/30 transition-colors">
            Stage Short
          </button>
        </div>
      )}
    </div>
  );
}
