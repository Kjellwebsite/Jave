'use client';

import type { ReactNode } from 'react';
import {
  Archive,
  ArrowRightLeft,
  CirclePause,
  CirclePlay,
  CircleX,
  Hand,
  type LucideIcon,
  RotateCcw,
  SignalHigh,
  UserMinus,
} from 'lucide-react';
import { Button, type ButtonProps, type ButtonVariant, NativeSelect, Textarea } from '@jave/ui';
import {
  optionsOf,
  PRIORITY_LABELS,
  type TicketControls,
  type TicketPriority,
} from '@/lib/ticket-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { useToastedAction } from '../toast';

const REASON_MIN = 3;
const REASON_MAX = 500;
const REASON_ROWS = 3;

export interface InstantActionProps {
  action: FormAction;
  hidden: Record<string, string>;
  label: string;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  testId?: string;
  className?: string;
}

/**
 * A one-click action (claim, resume, generate summary): no dialog. Every
 * result, success or refusal, is announced as a toast raised by the call
 * itself — the button often leaves the page with the state it changed (a
 * claimed ticket has no CLAIM), so an effect in it would never run.
 */
export function InstantAction({
  action,
  hidden,
  label,
  icon,
  variant = 'secondary',
  size = 'md',
  testId,
  className,
}: InstantActionProps) {
  const { run, pending } = useToastedAction(action);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      iconLeft={icon}
      loading={pending}
      data-testid={testId}
      className={className}
      onClick={() => {
        const data = new FormData();
        for (const [name, value] of Object.entries(hidden)) data.set(name, value);
        run(data);
      }}
    >
      {label}
    </Button>
  );
}

function ReasonField({ label, description }: { label: string; description: string }) {
  return (
    <FormField name="reason" label={label} description={description} required>
      <Textarea
        name="reason"
        required
        minLength={REASON_MIN}
        maxLength={REASON_MAX}
        rows={REASON_ROWS}
      />
    </FormField>
  );
}

/**
 * A dialog trigger. Radix's `asChild` hands the trigger its click handler,
 * ref and ARIA state as props, so every extra prop is passed through.
 */
function Trigger({
  icon,
  children,
  testId,
  ...rest
}: Omit<ButtonProps, 'children'> & {
  icon: LucideIcon;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      iconLeft={icon}
      data-testid={testId}
      className="w-full justify-start"
      {...rest}
    >
      {children}
    </Button>
  );
}

export interface TicketActionSet {
  claim: FormAction;
  unclaim: FormAction;
  transfer: FormAction;
  priority: FormAction;
  waiting: FormAction;
  resume: FormAction;
  close: FormAction;
  reopen: FormAction;
  archive: FormAction;
}

export interface TicketControlsProps {
  ticketId: string;
  reference: string;
  priority: TicketPriority;
  controls: TicketControls;
  /** Transfer targets (current handlers minus the assignee and the requester). */
  handlers: readonly { userId: string; displayName: string }[];
  actions: TicketActionSet;
}

/** The claim button for the page header: the view's one primary action. */
export function ClaimAction({ ticketId, action }: { ticketId: string; action: FormAction }) {
  return (
    <InstantAction
      action={action}
      hidden={{ ticketId }}
      label="Claim ticket"
      icon={Hand}
      variant="primary"
      testId="claim-ticket"
    />
  );
}

/**
 * Every other control the viewer may use on this ticket. Hidden when not
 * allowed; each dialog states the consequence; core re-authorizes on submit.
 */
export function TicketControlList({
  ticketId,
  reference,
  priority,
  controls,
  handlers,
  actions,
}: TicketControlsProps) {
  const hidden = { ticketId };
  return (
    <div className="grid grid-cols-2 gap-2">
      {controls.transfer && handlers.length > 0 ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Transfer ticket"
          description="The new handler is added to the thread and notified. The requester sees the new name on the card."
          confirmLabel="Transfer"
          action={actions.transfer}
          hidden={hidden}
          trigger={
            <Trigger icon={ArrowRightLeft} testId="transfer-ticket">
              Transfer
            </Trigger>
          }
        >
          <FormField name="toUserId" label="New handler" required>
            <NativeSelect
              name="toUserId"
              required
              defaultValue=""
              placeholder="Choose a handler"
              options={handlers.map((person) => ({
                value: person.userId,
                label: person.displayName,
              }))}
            />
          </FormField>
          <FormField
            name="reason"
            label="Reason"
            description="Optional. Staff only; never posted to the thread."
          >
            <Textarea name="reason" maxLength={REASON_MAX} rows={REASON_ROWS} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {controls.priority ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Set priority"
          description="While unanswered, the first-response target follows the priority. Raising to HIGH or URGENT alerts staff."
          confirmLabel="Set priority"
          action={actions.priority}
          hidden={hidden}
          trigger={
            <Trigger icon={SignalHigh} testId="set-priority">
              Priority
            </Trigger>
          }
        >
          <FormField name="priority" label="Priority" required>
            <NativeSelect
              name="priority"
              defaultValue={priority}
              options={optionsOf(PRIORITY_LABELS)}
            />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {controls.waiting ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Wait on requester"
          description="Posted in the thread and sent to the requester. Their next reply resumes the ticket. Counts as the first response."
          confirmLabel="Wait on requester"
          action={actions.waiting}
          hidden={hidden}
          trigger={
            <Trigger icon={CirclePause} testId="set-waiting">
              Wait on requester
            </Trigger>
          }
        >
          <ReasonField
            label="What the requester needs to do"
            description="Addressed to the requester. Posted in the thread."
          />
        </ConfirmActionDialog>
      ) : null}
      {controls.resume ? (
        <InstantAction
          action={actions.resume}
          hidden={hidden}
          label="Resume"
          icon={CirclePlay}
          size="sm"
          testId="resume-ticket"
          className="w-full justify-start"
        />
      ) : null}
      {controls.unclaim ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Release ticket"
          description="The ticket returns to the queue, unassigned. A released handler is notified when a manager releases them."
          confirmLabel="Release"
          action={actions.unclaim}
          hidden={hidden}
          trigger={
            <Trigger icon={UserMinus} testId="unclaim-ticket">
              Release
            </Trigger>
          }
        />
      ) : null}
      {controls.close ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Close ticket"
          description="The reason is posted in the thread, which is then locked and archived. It can be reopened."
          confirmLabel="Close ticket"
          tone="danger"
          action={actions.close}
          hidden={hidden}
          trigger={
            <Trigger icon={CircleX} testId="close-ticket">
              Close
            </Trigger>
          }
        >
          <ReasonField label="Reason" description="Shown to the requester in the thread." />
        </ConfirmActionDialog>
      ) : null}
      {controls.reopen ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Reopen ticket"
          description="The thread opens again and the reason is posted there."
          confirmLabel="Reopen ticket"
          action={actions.reopen}
          hidden={hidden}
          trigger={
            <Trigger icon={RotateCcw} testId="reopen-ticket">
              Reopen
            </Trigger>
          }
        >
          <ReasonField
            label="Reason"
            description="Why the ticket continues. Posted in the thread."
          />
        </ConfirmActionDialog>
      ) : null}
      {controls.archive ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Archive ticket"
          description="Final. The ticket becomes read-only: no messages, notes, summaries or reopening."
          confirmLabel="Archive"
          tone="danger"
          action={actions.archive}
          hidden={hidden}
          trigger={
            <Trigger icon={Archive} testId="archive-ticket">
              Archive
            </Trigger>
          }
        />
      ) : null}
    </div>
  );
}
