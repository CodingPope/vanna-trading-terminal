/**
 * Renders the keyboard map from `lib/shortcuts`.
 *
 * Shared by the shortcuts modal and the Settings dialog specifically so there
 * is no second hand-maintained copy to drift out of date — which is how
 * "Enter — Execute order" ended up on a help screen for a feature that was
 * never built.
 */
import { SHORTCUT_GROUPS } from '@/lib/shortcuts';

export function ShortcutTable({ columns = 3 }: { columns?: 1 | 3 }) {
  return (
    <div className={columns === 3 ? 'grid grid-cols-1 md:grid-cols-3 gap-6' : 'space-y-5'}>
      {SHORTCUT_GROUPS.map(group => (
        <div key={group.title}>
          <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-3">
            {group.title}
          </h3>
          <div className="space-y-2">
            {group.shortcuts.map(shortcut => (
              <div key={shortcut.keys} className="flex items-center gap-3">
                <kbd className="px-2 py-1 text-xs font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text min-w-[70px] text-center flex-shrink-0">
                  {shortcut.keys}
                </kbd>
                <span className="text-xs text-vanna-text-secondary flex-1">
                  {shortcut.description}
                  {shortcut.scope === 'focus-list' && (
                    <span
                      className="ml-1 text-[10px] text-vanna-text-secondary/60"
                      title="Only while the focus list panel is active"
                    >
                      (focus list)
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
