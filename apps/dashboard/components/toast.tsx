'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { Icon } from '@jave/ui';

const TOAST_DURATION_MS = 4_500;

interface ToastMessage {
  id: number;
  text: string;
}

const ToastContext = createContext<(text: string) => void>(() => undefined);

/** Announce a completed action ("ROLE GRANTED — SUPPORTER."). */
export function useToast(): (text: string) => void {
  return useContext(ToastContext);
}

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDone]);
  return (
    <li className="machined relative flex items-start gap-3 rounded-lg border border-line-strong bg-surface-overlay px-4 py-3 shadow-lg motion-safe:animate-rise-in">
      <Icon icon={CircleCheck} className="mt-0.5 text-success" />
      <p className="text-small text-fg">{toast.text}</p>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const push = useCallback((text: string) => {
    setToasts((current) => [...current.slice(-2), { id: Date.now() + Math.random(), text }]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <ol
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-80 flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:w-96"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDone={dismiss} />
        ))}
      </ol>
    </ToastContext.Provider>
  );
}
