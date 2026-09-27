'use client';

import Link from 'next/link';
import { ArrowRight, Ban, Pencil } from 'lucide-react';
import { Button, buttonStyles, Icon, Input, Textarea } from '@jave/ui';
import type { TrialStatusKey } from '@/lib/trial-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { ActionButton } from './action-button';

export interface LifecycleActions {
  open: FormAction;
  start: FormAction;
  close: FormAction;
  extend: FormAction;
  cancel: FormAction;
  reprovision: FormAction;
}

export interface LifecycleControlsProps {
  trialId: string;
  trialRef: string;
  status: TrialStatusKey;
  durationLabel: string;
  /** `datetime-local` value of the current recruitment close, in the viewer's zone. */
  recruitmentClosesAt: string;
  timeZone: string;
  /** Content may still change (the trials service's editable states). */
  editable: boolean;
  /** Teams exist and their channels can be re-synced. */
  resyncable: boolean;
  /** Not in a terminal state. */
  cancellable: boolean;
  actions: LifecycleActions;
}

const REASON_MIN = 3;
const REASON_MAX = 500;
const MAX_EXTENSION_MINUTES = 7 * 24 * 60;

function ReasonField({ description }: { description: string }) {
  return (
    <FormField name="reason" label="Reason" description={description} required>
      <Textarea name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={3} />
    </FormField>
  );
}

/**
 * The state machine's next steps for this trial, each behind a confirmation
 * that states its consequence. Only controls valid for the current state are
 * rendered; the trials service re-checks every transition.
 */
export function LifecycleControls({
  trialId,
  trialRef,
  status,
  durationLabel,
  recruitmentClosesAt,
  timeZone,
  editable,
  resyncable,
  cancellable,
  actions,
}: LifecycleControlsProps) {
  const hidden = { trialId };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-2">
        {status === 'draft' ? (
          <ConfirmActionDialog
            eyebrow={`LIFECYCLE · ${trialRef}`}
            title="Open recruitment"
            description="The recruitment card goes to the announcements channel. TRIAL and VERIFIED members apply with a statement. The brief stays sealed."
            confirmLabel="Open recruitment"
            action={actions.open}
            hidden={hidden}
            trigger={
              <Button variant="primary" data-testid="open-recruitment">
                Open recruitment
              </Button>
            }
          >
            <FormField
              name="recruitmentClosesAt"
              label="Recruitment closes"
              description={`Optional. ${timeZone}.`}
            >
              <Input
                name="recruitmentClosesAt"
                type="datetime-local"
                defaultValue={recruitmentClosesAt}
                mono
              />
            </FormField>
          </ConfirmActionDialog>
        ) : null}

        {status === 'recruiting' ? (
          <>
            <Link
              href={`/trials/${trialId}?tab=participants`}
              className={buttonStyles({ variant: 'primary' })}
            >
              Select participants
              <Icon icon={ArrowRight} size="sm" />
            </Link>
            <Link
              href={`/trials/${trialId}?tab=teams`}
              className={buttonStyles({ variant: 'secondary' })}
            >
              Assign teams
            </Link>
          </>
        ) : null}

        {status === 'teams_assigned' ? (
          <ConfirmActionDialog
            eyebrow={`LIFECYCLE · ${trialRef}`}
            title="Start trial"
            description={`The clock starts now: the deadline is ${durationLabel} away. The brief unseals and every team channel gets it.`}
            confirmLabel="Start trial"
            action={actions.start}
            hidden={hidden}
            trigger={
              <Button variant="primary" data-testid="start-trial">
                Start trial
              </Button>
            }
          />
        ) : null}

        {status === 'active' ? (
          <>
            <ConfirmActionDialog
              eyebrow={`LIFECYCLE · ${trialRef}`}
              title="Close submissions"
              description="Nothing further is accepted — late or not. Evaluators are notified and scoring opens."
              confirmLabel="Close submissions"
              action={actions.close}
              hidden={hidden}
              trigger={
                <Button variant="primary" data-testid="close-submissions">
                  Close submissions
                </Button>
              }
            />
            <ConfirmActionDialog
              eyebrow={`LIFECYCLE · ${trialRef}`}
              title="Extend deadline"
              description="Competitors are told the new deadline and the reason. Warnings are rescheduled."
              confirmLabel="Extend deadline"
              action={actions.extend}
              hidden={hidden}
              trigger={<Button data-testid="extend-deadline">Extend deadline</Button>}
            >
              <FormField name="minutes" label="Minutes to add" required>
                <Input
                  name="minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_EXTENSION_MINUTES}
                  required
                  mono
                />
              </FormField>
              <ReasonField description="Sent to every competitor." />
            </ConfirmActionDialog>
          </>
        ) : null}

        {status === 'evaluating' ? (
          <Link
            href={`/trials/${trialId}?tab=evaluation`}
            className={buttonStyles({ variant: 'primary' })}
          >
            Evaluate
            <Icon icon={ArrowRight} size="sm" />
          </Link>
        ) : null}

        {editable ? (
          <Link href={`/trials/${trialId}/edit`} className={buttonStyles({ variant: 'secondary' })}>
            <Icon icon={Pencil} size="sm" />
            Edit
          </Link>
        ) : null}

        {resyncable ? (
          <ActionButton
            action={actions.reprovision}
            label="Re-sync channels"
            icon="resync"
            hidden={hidden}
            data-testid="reprovision"
          />
        ) : null}
      </div>

      {cancellable ? (
        <div className="border-t border-line-subtle pt-3">
          <ConfirmActionDialog
            eyebrow={`LIFECYCLE · ${trialRef}`}
            title="Cancel trial"
            description="Every stakeholder is notified and team channels become read-only. This cannot be undone."
            confirmLabel="Cancel trial"
            tone="danger"
            action={actions.cancel}
            hidden={hidden}
            trigger={
              <Button variant="ghost" size="sm" iconLeft={Ban} data-testid="cancel-trial">
                Cancel trial
              </Button>
            }
          >
            <ReasonField description="Required. Sent to every stakeholder." />
          </ConfirmActionDialog>
        </div>
      ) : null}
    </div>
  );
}
