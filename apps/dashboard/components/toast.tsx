'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { cx, Icon, IconButton, Mono } from '@jave/ui';
import { type ActionState, actionToast, type ToastInput, type ToastTone } from '@/lib/action-state';

/** Confirmations fade on their own; failures stay long enough to read and copy the reference. */
const TOAST_DURATION_MS: Record<ToastTone, number> = { success: 4_500, danger: 12_000 };
const MAX_VISIBLE_TOASTS = 3;

interface ToastMessage extends Required<Pick<ToastInput, 'text' | 'tone'>> {
  id: number;
  reference?: string;
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

/** Announce an action's result: "ROLE GRANTED — SUPPORTER." or a failure with its reference. */
export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext);
}

/** Toasts every new result of a `useActionState` action, success or failure, in its own tone. */
export function useActionResultToast(state: ActionState): void {
  const toast = useToast();
  useEffect(() => {
    const next = actionToast(state);
    if (next) toast(next);
  }, [state, toast]);
}

const TONE_ICON = {
  success: { icon: CircleCheck, className: 'text-success' },
  danger: { icon: CircleAlert, className: 'text-danger' },
} as const;

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDone(toast.id), TOAST_DURATION_MS[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.tone, onDone]);
  const tone = TONE_ICON[toast.tone];
  return (
    <li
      data-tone={toast.tone}
      role={toast.tone === 'danger' ? 'alert' : undefined}
      className={cx(
        'machined pointer-events-auto relative flex w-full items-start gap-3 rounded-lg border bg-surface-overlay py-3 pl-4 pr-2 shadow-lg motion-safe:animate-rise-in',
        toast.tone === 'danger' ? 'border-danger/40' : 'border-line-strong',
      )}
    >
      <Icon icon={tone.icon} className={cx('mt-0.5', tone.className)} />
      <div className="min-w-0 flex-1 text-small">
        <p className="text-fg">{toast.text}</p>
        {toast.reference ? (
          <p className="mt-1 text-fg-muted">
            Reference <Mono className="select-all text-fg">{toast.reference}</Mono>
          </p>
        ) : null}
      </div>
      <IconButton icon={X} label="Dismiss" size="sm" onClick={() => onDone(toast.id)} />
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const push = useCallback((input: ToastInput) => {
    setToasts((current) => [
      ...current.slice(-(MAX_VISIBLE_TOASTS - 1)),
      {
        id: Date.now() + Math.random(),
        text: input.text,
        tone: input.tone ?? 'success',
        reference: input.reference,
      },
    ]);
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
