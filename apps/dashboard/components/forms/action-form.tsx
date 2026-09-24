'use client';

import {
  createContext,
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { Button, type ButtonVariant, Callout, cx, Mono } from '@jave/ui';
import { type ActionState, IDLE_STATE } from '@/lib/action-state';

export type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;

const ActionStateContext = createContext<ActionState>(IDLE_STATE);

/** Exposes a form's last result to FormField children (inline errors). */
export const ActionStateProvider = ActionStateContext.Provider;

/** Inline error for a field, from the enclosing ActionForm's last result. */
export function useActionFieldError(name: string): string | undefined {
  const state = useContext(ActionStateContext);
  return state.status === 'error' ? state.fieldErrors?.[name] : undefined;
}

export function ActionFeedback({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === 'idle') return null;
  if (state.status === 'success') {
    return (
      <Callout tone="success" role="status" className={className}>
        {state.message}
      </Callout>
    );
  }
  return (
    <Callout tone="danger" role="alert" className={className}>
      <span>{state.message}</span>
      {state.reference ? (
        <span className="mt-1 block">
          Reference <Mono className="select-all text-fg">{state.reference}</Mono>
        </span>
      ) : null}
    </Callout>
  );
}

export interface ActionFormProps {
  action: FormAction;
  children: ReactNode;
  /** Renders a submit button with this label (omit to supply your own). */
  submitLabel?: string;
  submitVariant?: ButtonVariant;
  /** Clear the form after a successful submission (e.g. "add note"). */
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  /** Read-only: every control is disabled and no submit is rendered. */
  readOnly?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Server Action form with pending state and result feedback. Submissions
 * run in a transition without React's automatic reset, so a rejected form
 * keeps what the user typed. Without JavaScript it still posts natively.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = 'primary',
  resetOnSuccess = false,
  onSuccess,
  readOnly = false,
  id,
  className,
  'aria-label': ariaLabel,
}: ActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (state.status !== 'success') return;
    if (resetOnSuccess) formRef.current?.reset();
    onSuccessRef.current?.();
  }, [state, resetOnSuccess]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <ActionStateContext.Provider value={state}>
      <form
        ref={formRef}
        id={id}
        action={dispatch}
        onSubmit={handleSubmit}
        aria-label={ariaLabel}
        aria-busy={pending || undefined}
        className={cx('space-y-5', className)}
      >
        <fieldset disabled={readOnly || pending} className="min-w-0 space-y-5">
          {children}
        </fieldset>
        <ActionFeedback state={state} />
        {submitLabel && !readOnly ? (
          <div className="flex justify-end">
            <Button type="submit" variant={submitVariant} loading={pending}>
              {submitLabel}
            </Button>
          </div>
        ) : null}
      </form>
    </ActionStateContext.Provider>
  );
}
