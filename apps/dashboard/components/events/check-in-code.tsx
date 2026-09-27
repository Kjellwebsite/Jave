'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button, Input, Mono } from '@jave/ui';
import { IDLE_STATE } from '@/lib/action-state';
import { type CheckInCodeState, hasIssuedCode } from '@/lib/check-in-code-state';
import { ActionFeedback, ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export type CheckInCodeAction = (
  state: CheckInCodeState,
  data: FormData,
) => Promise<CheckInCodeState>;

export interface CheckInCodeIssuerProps {
  eventId: string;
  action: CheckInCodeAction;
  /** A code exists already: issuing again rotates it. */
  issued: boolean;
}

/**
 * Staff: issue or rotate the check-in code. The code appears once, here, in
 * this browser's memory; JAVE stores only a hash and cannot show it again.
 * Rotating invalidates the code attendees may be holding, so it is confirmed.
 */
export function CheckInCodeIssuer({ eventId, action, issued }: CheckInCodeIssuerProps) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const [confirming, setConfirming] = useState(false);
  const rotates = issued || hasIssuedCode(state);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setConfirming(false);
    startTransition(() => dispatch(data));
  }

  return (
    <div className="space-y-4">
      {hasIssuedCode(state) ? (
        <div
          className="rounded-md border border-line-strong bg-surface-sunken px-5 py-4"
          data-testid="check-in-code"
        >
          <p className="type-eyebrow text-fg-subtle">CHECK-IN CODE · SHOWN ONCE</p>
          <p className="type-data mt-2 select-all text-[26px] tracking-[0.2em] text-fg">
            {state.code}
          </p>
          <p className="mt-2 text-small text-fg-subtle">
            Valid <Mono>{state.opensAt}</Mono> → <Mono>{state.closesAt}</Mono>. Share it on site or
            on stream.
          </p>
        </div>
      ) : (
        <ActionFeedback state={state} />
      )}
      <form onSubmit={handleSubmit} action={dispatch} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="eventId" value={eventId} />
        {/*
          Keys give each step its own button element: reusing the clicked
          type="button" as a submit button mid-click would submit the form and
          rotate the code without the confirmation.
        */}
        {rotates && !confirming ? (
          <>
            <Button
              key="rotate"
              type="button"
              variant="secondary"
              iconLeft={KeyRound}
              loading={pending}
              onClick={() => setConfirming(true)}
            >
              Issue a new code
            </Button>
            <p className="text-small text-fg-subtle">
              A new code replaces the current one immediately.
            </p>
          </>
        ) : rotates ? (
          <>
            <Button
              key="replace"
              type="submit"
              variant="danger"
              iconLeft={KeyRound}
              loading={pending}
            >
              Replace code
            </Button>
            <Button key="keep" type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Keep current code
            </Button>
            <p className="w-full text-small text-fg-subtle">
              Members holding the current code can no longer check in with it.
            </p>
          </>
        ) : (
          <>
            <Button
              key="issue"
              type="submit"
              variant="primary"
              iconLeft={KeyRound}
              loading={pending}
            >
              Issue check-in code
            </Button>
            <p className="text-small text-fg-subtle">
              Members enter it with /events checkin or on this page.
            </p>
          </>
        )}
      </form>
    </div>
  );
}

export interface CheckInFormProps {
  eventId: string;
  action: FormAction;
  codeMax: number;
}

/** Members: enter the code shared at the event. */
export function CheckInForm({ eventId, action, codeMax }: CheckInFormProps) {
  return (
    <ActionForm
      action={action}
      submitLabel="Check in"
      submitVariant="secondary"
      aria-label="Check in"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <FormField name="code" label="Check-in code" description="Shared by the host at the event.">
        <Input
          name="code"
          required
          maxLength={codeMax}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          mono
        />
      </FormField>
    </ActionForm>
  );
}
