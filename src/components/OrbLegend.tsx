/**
 * What the orb is telling you.
 *
 * Four visual channels carry four statistics, and without a key that is just a
 * decorative blob. Each row shows the mapping *and* the current reading, so it
 * doubles as a readout: you can look at the sphere, look here, and confirm you
 * read it correctly.
 *
 * Values come from the same hook the orb uses, so the key cannot describe
 * something other than what is on screen.
 */
import { useMarketPulse } from '@/hooks/useMarketPulse';
import { useUIStore } from '@/store/uiStore';
import { normalise, PULSE_SCALE } from '@/lib/marketPulse';
import type { OrbScope } from '@/types';

const SCOPES: Array<{ value: OrbScope; label: string; hint: string }> = [
  { value: 'market', label: 'Whole market', hint: 'All symbols on the feed' },
  { value: 'focus', label: 'Focus list', hint: 'Only the names you are watching' },
];

/** Plain-language reading for a normalised 0..1 channel. */
function band(n: number, low: string, mid: string, high: string): string {
  return n < 0.33 ? low : n < 0.66 ? mid : high;
}

function Row({
  channel,
  meaning,
  reading,
}: {
  channel: string;
  meaning: string;
  reading: string;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr_auto] gap-2 items-baseline py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-vanna-cyan">{channel}</span>
      <span className="text-xs text-vanna-text-secondary">{meaning}</span>
      <span className="font-mono text-[11px] text-vanna-text text-right">{reading}</span>
    </div>
  );
}

export function OrbLegend() {
  const { pulse, scope } = useMarketPulse();
  const updateSettings = useUIStore(s => s.updateSettings);

  const dispersion = normalise(pulse.dispersion, PULSE_SCALE.dispersion);
  const volatility = normalise(pulse.volatility, PULSE_SCALE.volatility);
  const advancing = Math.round(pulse.breadth * 100);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-vanna-text">
          Market orb
        </span>
        <span className="text-[10px] text-vanna-text-secondary ml-auto">
          {pulse.sampleSize} symbol{pulse.sampleSize === 1 ? '' : 's'}
        </span>
      </div>

      <p className="text-xs text-vanna-text-secondary mb-3">
        A summary of the market you can read without reading numbers.
      </p>

      <div className="divide-y divide-white/5 mb-4">
        <Row
          channel="Shape"
          meaning="Dispersion — how far names stray from the average move. Smooth means they are moving together, lumpy means they are pulling apart."
          reading={band(dispersion, 'smooth', 'rippling', 'churning')}
        />
        <Row
          channel="Speed"
          meaning="Volatility — how much is happening, whichever way."
          reading={band(volatility, 'calm', 'active', 'fast')}
        />
        <Row
          channel="Colour"
          meaning="Direction — green when the market is up, red when it is down."
          reading={`${pulse.trend >= 0 ? '+' : ''}${pulse.trend.toFixed(2)}%`}
        />
        <Row
          channel="Detail"
          meaning="Breadth — how many names are taking part. Fine detail is broad participation, few large lobes is narrow leadership."
          reading={`${advancing}% up`}
        />
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-vanna-text">Based on</span>
      </div>
      <div className="flex items-center gap-1">
        {SCOPES.map(option => (
          <button
            key={option.value}
            onClick={() => updateSettings({ orbScope: option.value })}
            aria-pressed={scope === option.value}
            title={option.hint}
            className={`px-2 py-1 text-[10px] rounded transition-colors
              ${scope === option.value
                ? 'bg-vanna-cyan/20 text-vanna-cyan'
                : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-vanna-text-secondary mt-2">
        The whole market can be calm while the handful of names you are watching
        tear apart — they are different questions.
      </p>
    </div>
  );
}
