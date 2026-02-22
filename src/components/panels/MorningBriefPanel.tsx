import { useState } from 'react';
import { useMarket, useUI, MORNING_BRIEF_TEMPLATES } from '@/store';
import { 
  Sunrise, 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  Globe,
  Zap,
  ChevronRight
} from 'lucide-react';

export function MorningBriefPanel() {
  const { state, setPhase } = useMarket();
  const { addNotification } = useUI();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateFocus = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      addNotification({ type: 'success', message: 'Focus list generated: 12 symbols' });
      setPhase('pre-market');
    }, 2000);
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    addNotification({ type: 'info', message: `Template loaded: ${templateId}` });
  };

  const todayFocus = state.focusList.slice(0, 5);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Sunrise className="w-4 h-4 text-vanna-gold" />
          <span className="header-caps">Morning Brief</span>
        </div>
        <span className="text-[10px] text-vanna-text-secondary">
          {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Templates section */}
        <div>
          <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-2">
            Pre-built Templates
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {MORNING_BRIEF_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className={`glass-panel p-3 text-left transition-all hover:border-vanna-cyan/30
                  ${selectedTemplate === template.id ? 'border-vanna-cyan/50 bg-vanna-cyan/5' : ''}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {template.id === 'momentum' && <TrendingUp className="w-4 h-4 text-vanna-green" />}
                    {template.id === 'earnings' && <DollarSign className="w-4 h-4 text-vanna-gold" />}
                    {template.id === 'macro' && <Globe className="w-4 h-4 text-vanna-cyan" />}
                    <span className="font-mono text-sm text-vanna-text">{template.name}</span>
                  </div>
                  {selectedTemplate === template.id && (
                    <ChevronRight className="w-4 h-4 text-vanna-cyan" />
                  )}
                </div>
                <p className="text-xs text-vanna-text-secondary mt-1 ml-6">
                  {template.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Today's Focus */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">
              Today's Focus
            </h3>
            <span className="text-[10px] text-vanna-cyan">
              {todayFocus.length} setups
            </span>
          </div>
          
          <div className="glass-panel overflow-hidden">
            {todayFocus.map((item, index) => (
              <div
                key={item.symbol}
                className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono
                    ${index === 0 ? 'bg-vanna-gold/20 text-vanna-gold' : 
                      index === 1 ? 'bg-vanna-surface-light text-vanna-text-secondary' :
                      index === 2 ? 'bg-vanna-surface-light text-vanna-text-secondary' :
                      'text-vanna-text-secondary'}`}>
                    {index + 1}
                  </span>
                  <div>
                    <span className="font-mono text-sm text-vanna-text">{item.symbol}</span>
                    <span className="text-[10px] text-vanna-text-secondary ml-2">{item.sector}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <BarChart3 className="w-3 h-3 text-vanna-text-secondary" />
                    <span className={`font-mono text-xs ${
                      item.setupQuality >= 85 ? 'text-vanna-green' : 'text-vanna-gold'
                    }`}>
                      {item.setupQuality}
                    </span>
                  </div>
                  <span className={`font-mono text-xs ${
                    item.marketData.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'
                  }`}>
                    {item.marketData.changePercent >= 0 ? '+' : ''}{item.marketData.changePercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Market Overview */}
        <div>
          <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-2">
            Market Regime
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div className="glass-panel p-2">
              <span className="text-[9px] text-vanna-text-secondary uppercase">Trend</span>
              <p className={`font-mono text-sm ${
                state.marketRegime.trend === 'bullish' ? 'text-vanna-green' :
                state.marketRegime.trend === 'bearish' ? 'text-vanna-red' :
                'text-vanna-gold'
              }`}>
                {state.marketRegime.trend.toUpperCase()}
              </p>
            </div>
            <div className="glass-panel p-2">
              <span className="text-[9px] text-vanna-text-secondary uppercase">Volatility</span>
              <p className={`font-mono text-sm ${
                state.marketRegime.volatility === 'high' ? 'text-vanna-red' :
                state.marketRegime.volatility === 'medium' ? 'text-vanna-gold' :
                'text-vanna-green'
              }`}>
                {state.marketRegime.volatility.toUpperCase()}
              </p>
            </div>
            <div className="glass-panel p-2">
              <span className="text-[9px] text-vanna-text-secondary uppercase">Breadth</span>
              <p className={`font-mono text-sm ${
                state.marketRegime.breadth === 'strong' ? 'text-vanna-green' :
                state.marketRegime.breadth === 'weak' ? 'text-vanna-red' :
                'text-vanna-gold'
              }`}>
                {state.marketRegime.breadth.toUpperCase()}
              </p>
            </div>
            <div className="glass-panel p-2">
              <span className="text-[9px] text-vanna-text-secondary uppercase">Sentiment</span>
              <p className={`font-mono text-sm ${
                state.marketRegime.sentiment === 'greed' ? 'text-vanna-green' :
                state.marketRegime.sentiment === 'fear' ? 'text-vanna-red' :
                'text-vanna-gold'
              }`}>
                {state.marketRegime.sentiment.toUpperCase()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Generate button */}
      <div className="px-3 py-3 border-t border-white/5">
        <button
          onClick={handleGenerateFocus}
          disabled={isGenerating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 
                     bg-vanna-cyan/20 border border-vanna-cyan/40 rounded
                     text-vanna-cyan font-medium hover:bg-vanna-cyan/30 
                     transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-vanna-cyan/30 border-t-vanna-cyan rounded-full animate-spin" />
              <span>Scanning Universe...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              <span>Generate Focus List</span>
            </>
          )}
        </button>
        <p className="text-center text-[10px] text-vanna-text-secondary mt-2">
          Scans 300 symbols → Filters to 12 → Ranks by setup quality
        </p>
      </div>
    </div>
  );
}
