/**
 * Settings.
 *
 * The store has carried a `settings` object and an `updateSettings` action from
 * the start, and `showSettings` alongside them — but nothing rendered any of
 * it, so the gear in the header was an empty click handler over state no one
 * could reach. This is the missing surface.
 *
 * Settings persist: uiStore's `partialize` writes `settings` and
 * `sidebarCollapsed` to localStorage and leaves transient UI alone.
 */
import { useUIStore } from '@/store/uiStore';
import { X, Settings as SettingsIcon, Keyboard } from 'lucide-react';
import { ShortcutTable } from './ShortcutTable';
import type { UserSettings } from '@/types';

const TIMEFRAMES: UserSettings['defaultTimeframe'][] = ['1m', '5m', '15m', '1h', '1d'];

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 py-3 cursor-pointer group">
      <span className="flex-1">
        <span className="block text-sm text-vanna-text">{label}</span>
        <span className="block text-xs text-vanna-text-secondary mt-0.5">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 mt-0.5
          ${checked ? 'bg-vanna-cyan/60' : 'bg-white/10'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  );
}

export function SettingsDialog() {
  const showSettings = useUIStore(s => s.showSettings);
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const settings = useUIStore(s => s.settings);
  const updateSettings = useUIStore(s => s.updateSettings);

  if (!showSettings) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleSettings();
      }}
    >
      <div
        className="glass-panel w-full max-w-lg max-h-[80vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-vanna-cyan" />
            <h2 className="text-sm text-vanna-text uppercase tracking-wider">Settings</h2>
          </div>
          <button
            onClick={toggleSettings}
            className="p-1 rounded hover:bg-white/5 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-4 h-4 text-vanna-text-secondary" />
          </button>
        </div>

        <div className="px-4 py-2 divide-y divide-white/5">
          <Toggle
            label="High contrast"
            hint="Stronger foreground contrast for low-light desks"
            checked={settings.highContrastMode}
            onChange={v => updateSettings({ highContrastMode: v })}
          />
          <Toggle
            label="Sound"
            hint="Audio cue on fills and triggered alerts"
            checked={settings.soundEnabled}
            onChange={v => updateSettings({ soundEnabled: v })}
          />
          <Toggle
            label="Notifications"
            hint="Show toasts for alerts and system events"
            checked={settings.notificationsEnabled}
            onChange={v => updateSettings({ notificationsEnabled: v })}
          />

          <div className="py-3">
            <span className="block text-sm text-vanna-text">Default timeframe</span>
            <span className="block text-xs text-vanna-text-secondary mt-0.5 mb-2">
              Applied to newly opened charts
            </span>
            <div className="flex items-center gap-1">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => updateSettings({ defaultTimeframe: tf })}
                  aria-pressed={settings.defaultTimeframe === tf}
                  className={`px-2 py-1 text-[10px] font-mono rounded transition-colors
                    ${settings.defaultTimeframe === tf
                      ? 'bg-vanna-cyan/20 text-vanna-cyan'
                      : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-vanna-text">Risk per trade</span>
              <span className="font-mono text-sm text-vanna-gold">
                {settings.riskPerTrade.toFixed(1)}%
              </span>
            </div>
            <span className="block text-xs text-vanna-text-secondary mt-0.5 mb-2">
              Share of account equity risked on a single position
            </span>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={settings.riskPerTrade}
              aria-label="Risk per trade"
              onChange={e => updateSettings({ riskPerTrade: Number(e.target.value) })}
              className="w-full accent-vanna-cyan"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <Keyboard className="w-3.5 h-3.5 text-vanna-cyan" />
            <span className="text-[11px] uppercase tracking-wider text-vanna-text">
              Keyboard shortcuts
            </span>
            <span className="text-[10px] text-vanna-text-secondary ml-auto">
              also on <kbd className="px-1 py-0.5 bg-vanna-surface border border-white/10 rounded">?</kbd>
            </span>
          </div>
          {/* Same source as the ? modal — one list, so they cannot disagree. */}
          <ShortcutTable columns={1} />
        </div>

        <div className="px-4 py-3 border-t border-white/5 text-[10px] text-vanna-text-secondary">
          Settings are saved to this browser.
        </div>
      </div>
    </div>
  );
}
