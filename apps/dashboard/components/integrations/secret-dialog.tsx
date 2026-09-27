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
import { KeyRound } from 'lucide-react';
import { Button, Callout, Dialog, DialogClose, DialogContent, DialogTrigger } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import type { SecretActionState } from '@/lib/integration-view';
import { ActionFeedback, ActionStateProvider } from '../forms/action-form';
import { useToast } from '../toast';
import { CopyField } from './copy-field';

export type SecretAction = (state: SecretActionState, data: FormData) => Promise<SecretActionState>;

export interface SecretDialogProps {
  trigger: ReactElement;
  eyebrow: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  action: SecretAction;
  hidden?: Record<string, string>;
  children?: ReactNode;
  /** What the operator does with the secret, shown beside it. */
  secretHint: ReactNode;
}

interface SecretFormProps extends Omit<
  SecretDialogProps,
  'trigger' | 'eyebrow' | 'title' | 'description'
> {
  onPendingChange: (pending: boolean) => void;
  onDone: (message: string) => void;
}

function SecretForm({
  confirmLabel,
  tone,
  action,
  hidden = {},
  children,
  secretHint,
  onPendingChange,
  onDone,
}: SecretFormProps) {
  const [state, dispatch, pending] = useActionState<SecretActionState, FormData>(
    action,
    IDLE_STATE,
  );
  const callbacks = useRef({ onPendingChange, onDone });

  useEffect(() => {
    callbacks.current = { onPendingChange, onDone };
  });
  useEffect(() => {
    callbacks.current.onPendingChange(pending);
  }, [pending]);
  useEffect(() => {
    // Without a secret (e.g. GitHub integrations) there is nothing to reveal: close.
    if (state.status === 'success' && !state.secret) callbacks.current.onDone(state.message);
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  if (state.status === 'success' && state.secret) {
    return (
      <div className="space-y-4">
        <Callout tone="success" role="status">
          {state.message}
        </Callout>
        <CopyField value={state.secret} label="Signing secret" data-testid="signing-secret" />
        <Callout tone="warning" title="SHOWN ONCE">
          {secretHint}
        </Callout>
        <div className="-mx-5 -mb-5 flex justify-end border-t border-line-subtle px-5 py-3.5">
          <DialogClose asChild>
            <Button variant="primary">I stored it</Button>
          </DialogClose>
        </div>
      </div>
    );
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
            iconLeft={KeyRound}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </ActionStateProvider>
  );
}

/**
 * Dialog for actions that issue a signing secret (create, rotate). On
 * success the secret is revealed once, with a copy button, and disappears
 * when the dialog closes — it is never rendered anywhere else.
 */
export function SecretDialog({ trigger, eyebrow, title, description, ...form }: SecretDialogProps) {
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
      <DialogContent size="md" eyebrow={eyebrow} title={title} description={description}>
        <SecretForm
          key={session}
          {...form}
          onPendingChange={setPending}
          onDone={(message) => {
            setOpen(false);
            toast({ text: message, tone: 'success' });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
