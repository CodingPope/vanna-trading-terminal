/**
 * Notification history.
 *
 * The toasts in Notifications.tsx auto-dismiss after five seconds, so anything
 * that fired while you were reading a chart was gone with no way to get it
 * back. The bell previously had an empty click handler and a permanently-lit
 * unread dot over exactly nothing.
 */
import { useEffect, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { Bell, CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const TONE = {
  success: 'text-vanna-green',
  error: 'text-vanna-red',
  warning: 'text-vanna-gold',
  info: 'text-vanna-cyan',
} as const;

function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function NotificationCenter({
  open,
  onClose,
  now,
}: {
  open: boolean;
  onClose: () => void;
  /** Passed in so the component stays pure — reading the clock during render
      is impure and the lint rules reject it. */
  now: number;
}) {
  const notifications = useUIStore(s => s.notifications);
  const removeNotification = useUIStore(s => s.removeNotification);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute top-full right-0 mt-1 w-80 glass-panel z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Bell className="w-3.5 h-3.5 text-vanna-cyan" />
          <span className="text-[11px] uppercase tracking-wider text-vanna-text">
            Notifications
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close notifications"
          className="p-1 rounded hover:bg-white/5 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-vanna-text-secondary" />
        </button>
      </div>

      <div className="max-h-80 overflow-auto">
        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-vanna-text-secondary">
            No notifications
          </p>
        ) : (
          notifications.map(n => {
            const Icon = ICONS[n.type];
            return (
              <div
                key={n.id}
                className="flex items-start gap-2 px-3 py-2 border-b border-white/5 last:border-0 group"
              >
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${TONE[n.type]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-vanna-text break-words">{n.message}</p>
                  <p className="text-[10px] text-vanna-text-secondary mt-0.5">
                    {timeAgo(n.timestamp, now)}
                  </p>
                </div>
                <button
                  onClick={() => removeNotification(n.id)}
                  aria-label={`Dismiss: ${n.message}`}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/5 transition"
                >
                  <X className="w-3 h-3 text-vanna-text-secondary" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
