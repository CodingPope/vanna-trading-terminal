import { useUIStore } from '@/store/uiStore';
import { X, Keyboard } from 'lucide-react';
import { ShortcutTable } from './ShortcutTable';

export function KeyboardShortcuts() {
  const showKeyboardShortcuts = useUIStore(s => s.showKeyboardShortcuts);
  const toggleKeyboardShortcuts = useUIStore(s => s.toggleKeyboardShortcuts);

  if (!showKeyboardShortcuts) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleKeyboardShortcuts();
      }}
    >
      <div
        className="glass-panel w-full max-w-2xl max-h-[80vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-vanna-cyan" />
            <h2 className="text-lg font-semibold text-vanna-text">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={toggleKeyboardShortcuts}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Close shortcuts"
          >
            <X className="w-5 h-5 text-vanna-text-secondary" />
          </button>
        </div>

        {/* Rendered from lib/shortcuts, the same source Settings uses. */}
        <div className="p-4">
          <ShortcutTable columns={3} />
        </div>
      </div>
    </div>
  );
}
