'use client';

import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button, Dialog, DialogClose, DialogContent, DialogTrigger } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import { useToast } from '../toast';
import { ActionFeedback, ActionStateProvider, type FormAction } from './action-form';

export interface ConfirmActionDialogProps {
  trigger: ReactElement;
  eyebrow?: string;
  title: ReactNode;
  description: ReactNode;
  /** Says exactly what happens: "Grant role", "Revoke CORE". */
  confirmLabel: string;
  tone?: 'default' | 'danger';
  action: FormAction;
  /** Identifiers the action needs (validated and authorized server-side). */
  hidden?: Record<string, string>;
  /** The inputs: reason, rank, evidence… */
  children?: ReactNode;
}

interface ConfirmFormProps extends Pick<
  ConfirmActionDialogProps,
  'confirmLabel' | 'tone' | 'action' | 'hidden' | 'children'
> {
  onPendingChange: (pending: boolean) => void;
  onSuccess: (message: string) => void;
}

function ConfirmForm({
  confirmLabel,
  tone,
  action,
  hidden = {},
  children,
  onPendingChange,
  onSuccess,
}: ConfirmFormProps) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const callbacks = useRef({ onPendingChange, onSuccess });

  useEffect(() => {
    callbacks.current = { onPendingChange, onSuccess };
  });

  useEffect(() => {
    callbacks.current.onPendingChange(pending);
  }, [pending]);

  useEffect(() => {
    if (state.status === 'success') callbacks.current.onSuccess(state.message);
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <ActionStateProvider value={state}>
      <form action={dispatch} onSubmit={handleSubmit} className="space-y-5">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {children ? (
          <fieldset disabled={pending} className="min-w-0 space-y-4">
            {children}
          </fieldset>
        ) : null}
        {state.status === 'error' ? <ActionFeedback state={state} /> : null}
        <div className="-mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-line-subtle px-5 py-3.5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="submit"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </ActionStateProvider>
  );
}

/**
 * Two-step confirmation for consequential actions. Stays open with the error
 * on failure; closes and announces the result on success. Each opening starts
 * from a clean form.
 */
export function ConfirmActionDialog({
  trigger,
  eyebrow = 'CONFIRM',
  title,
  description,
  ...form
}: ConfirmActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setSession((count) => count + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm" eyebrow={eyebrow} title={title} description={description}>
        <ConfirmForm
          key={session}
          {...form}
          onPendingChange={setPending}
          onSuccess={(message) => {
            setOpen(false);
            toast(message);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
