import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export function Notifications() {
  const notifications = useUIStore(s => s.notifications);
  const removeNotification = useUIStore(s => s.removeNotification);

  // Auto-dismiss notifications after 5 seconds
  useEffect(() => {
    notifications.forEach(notification => {
      const timeout = setTimeout(() => {
        removeNotification(notification.id);
      }, 5000);
      return () => clearTimeout(timeout);
    });
  }, [notifications, removeNotification]);

  if (notifications.length === 0) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-vanna-green" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-vanna-red" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-vanna-gold" />;
      default:
        return <Info className="w-4 h-4 text-vanna-cyan" />;
    }
  };

  return (
    /* Bottom right, above the stats footer. Top right put toasts directly over
       the workspace controls, so the welcome toast covered Reset/Save/Delete
       for its whole five-second life. */
    <div className="fixed bottom-10 right-4 z-[90] space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className="glass-panel flex items-start gap-3 px-4 py-3 min-w-[300px] max-w-[400px] animate-in slide-in-from-right duration-200"
          role="alert"
        >
          {getIcon(notification.type)}
          <div className="flex-1">
            <p className="text-sm text-vanna-text">{notification.message}</p>
          </div>
          <button
            onClick={() => removeNotification(notification.id)}
            className="p-0.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-vanna-text-secondary" />
          </button>
        </div>
      ))}
    </div>
  );
}
