import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { usePresence } from '../hooks/usePresence';

// ── Types ──────────────────────────────────────────────────────────────────
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  onClick?: () => void;
  leaving?: boolean;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface NotificationsContextValue {
  notify: (type: ToastType, message: string, title?: string, onClick?: () => void) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// ── Public helpers (usable outside React: socket handlers, services) ───────
let notifyRef: ((type: ToastType, message: string, title?: string, onClick?: () => void) => void) | null = null;
let confirmRef: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/** Show a floating toast notification (works outside React components). */
export const notify = (type: ToastType, message: string, title?: string, onClick?: () => void): void => {
  if (notifyRef) notifyRef(type, message, title, onClick);
  else console.log(`[notify:${type}]`, message);
};

/** Open the in-app confirmation modal. Resolves true if the user confirms. */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> => {
  if (confirmRef) return confirmRef(options);
  // Fallback (should not happen): native confirm
  return Promise.resolve(window.confirm(`${options.title}\n\n${options.message}`));
};

export const useNotifications = (): NotificationsContextValue => {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return ctx;
};

// ── Provider ───────────────────────────────────────────────────────────────
const TOAST_DURATION = 5000;
const TOAST_EXIT_MS = 250;

type ToastTimers = { mark?: ReturnType<typeof setTimeout>; remove?: ReturnType<typeof setTimeout> };

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmPresence = usePresence(confirmOpen, 200);
  const timersRef = useRef<Map<string, ToastTimers>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timers = timersRef.current.get(id);
    if (timers) {
      if (timers.mark) clearTimeout(timers.mark);
      if (timers.remove) clearTimeout(timers.remove);
      timersRef.current.delete(id);
    }
  }, []);

  // Play the exit animation, then remove the toast from the stack
  const dismissToast = useCallback(
    (id: string) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      const timers = timersRef.current.get(id);
      if (timers?.mark) clearTimeout(timers.mark);
      if (timers?.remove) return; // exit already in progress
      const removeTimer = setTimeout(() => removeToast(id), TOAST_EXIT_MS);
      if (timers) timers.remove = removeTimer;
      else timersRef.current.set(id, { remove: removeTimer });
    },
    [removeToast]
  );

  const notifyFn = useCallback(
    (type: ToastType, message: string, title?: string, onClick?: () => void) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev.slice(-3), { id, type, title, message, onClick }]);
      const markTimer = setTimeout(() => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
        const removeTimer = setTimeout(() => removeToast(id), TOAST_EXIT_MS);
        const entry = timersRef.current.get(id);
        if (entry) entry.remove = removeTimer;
        else timersRef.current.set(id, { remove: removeTimer });
      }, TOAST_DURATION);
      timersRef.current.set(id, { mark: markTimer });
    },
    [removeToast]
  );

  const confirmFn = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        setConfirmState((prev) => {
          // If a dialog is already open, resolve it as "cancelled"
          if (prev) prev.resolve(false);
          return { options, resolve };
        });
        setConfirmOpen(true);
      }),
    []
  );

  // Expose helpers for non-React call sites
  notifyRef = notifyFn;
  confirmRef = confirmFn;

  const resolveConfirm = (value: boolean) => {
    if (confirmState) confirmState.resolve(value);
    setConfirmOpen(false);
  };

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle2 size={18} />,
    error: <XCircle size={18} />,
    warning: <AlertTriangle size={18} />,
    info: <Info size={18} />,
  };

  return (
    <NotificationsContext.Provider value={{ notify: notifyFn, confirm: confirmFn }}>
      {children}

      {/* ── Toast stack (top, right below the nav) ── */}
      <div className="notif-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`notif-toast notif-toast--${toast.type} ${toast.leaving ? 'notif-toast--leaving' : ''}`}
            onClick={
              toast.onClick
                ? () => {
                    toast.onClick?.();
                    dismissToast(toast.id);
                  }
                : undefined
            }
            style={toast.onClick ? { cursor: 'pointer' } : undefined}
          >
            <span className={`notif-toast__icon notif-toast__icon--${toast.type}`}>
              {icons[toast.type]}
            </span>
            <div className="notif-toast__body">
              {toast.title && <strong className="notif-toast__title">{toast.title}</strong>}
              <span className="notif-toast__message">{toast.message}</span>
            </div>
            <button
              type="button"
              className="notif-toast__close"
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(toast.id);
              }}
              title="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Confirmation modal (with exit animation) ── */}
      {confirmPresence.shown && confirmState && (
        <div
          className={`modal-overlay ${confirmPresence.closing ? 'modal-overlay--closing' : ''}`}
          onClick={() => resolveConfirm(false)}
        >
          <div
            className={`modal-card notif-confirm ${confirmPresence.closing ? 'modal-card--closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
          >
            <h3 className="notif-confirm__title">{confirmState.options.title}</h3>
            <p className="notif-confirm__message">{confirmState.options.message}</p>
            <div className="notif-confirm__actions">
              <button
                type="button"
                className="notif-confirm__btn notif-confirm__btn--cancel"
                onClick={() => resolveConfirm(false)}
              >
                {confirmState.options.cancelLabel || 'Cancelar'}
              </button>
              <button
                type="button"
                className={`notif-confirm__btn ${
                  confirmState.options.danger
                    ? 'notif-confirm__btn--danger'
                    : 'notif-confirm__btn--primary'
                }`}
                autoFocus
                onClick={() => resolveConfirm(true)}
              >
                {confirmState.options.confirmLabel || 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NotificationsContext.Provider>
  );
};
