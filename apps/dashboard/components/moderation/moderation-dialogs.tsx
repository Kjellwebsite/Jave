'use client';

import { Check, CircleSlash, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import { Button, Textarea } from '@jave/ui';
import {
  CASE_ACTION_LABELS,
  type CaseActionKey,
  EVENT_STATUS_LABELS,
  type EventStatusKey,
  REVIEW_TARGETS,
} from '@/lib/moderation-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Mirrors core: reasons 3–1000 characters, review notes up to 1000. */
const REASON_MIN = 3;
const TEXT_MAX = 1000;

function ReasonField({ description }: { description: string }) {
  return (
    <FormField name="reason" label="Reason" description={description} required>
      <Textarea name="reason" required minLength={REASON_MIN} maxLength={TEXT_MAX} rows={3} />
    </FormField>
  );
}

/*
 * Dialogs stay mounted when their action stops being available (the page
 * refreshes with the result), so the success toast still fires; only the
 * trigger is hidden, with the HTML `hidden` attribute.
 */

export interface RevokeCaseDialogProps {
  caseId: string;
  reference: string;
  action: CaseActionKey;
  inForce: boolean;
  /** False once revoked: the trigger hides. */
  available: boolean;
  revokeAction: FormAction;
}

export function RevokeCaseDialog({
  caseId,
  reference,
  action,
  inForce,
  available,
  revokeAction,
}: RevokeCaseDialogProps) {
  const label = CASE_ACTION_LABELS[action].toLowerCase();
  return (
    <ConfirmActionDialog
      eyebrow="MODERATION"
      title={`Revoke ${reference}`}
      description={
        inForce
          ? `Strikes ${reference} from the record and lifts the ${label} in Discord. The member is notified.`
          : `Strikes ${reference} from the record. Nothing changes in Discord.`
      }
      confirmLabel="Revoke case"
      tone="danger"
      action={revokeAction}
      hidden={{ caseId }}
      trigger={
        <Button variant="danger" iconLeft={Undo2} data-testid="revoke-case" hidden={!available}>
          Revoke case
        </Button>
      }
    >
      <ReasonField description="Appeal granted, issued in error… Recorded in the audit log." />
    </ConfirmActionDialog>
  );
}

const REVIEW_COPY: Record<
  Exclude<EventStatusKey, 'open'>,
  { label: string; description: string; icon: typeof Check }
> = {
  acknowledged: {
    label: 'Acknowledge',
    description: 'Marks the event as seen and under review. It stays in the review queue.',
    icon: Check,
  },
  dismissed: {
    label: 'Dismiss',
    description: 'Closes the event with no action. The alert card in Discord loses its buttons.',
    icon: CircleSlash,
  },
  actioned: {
    label: 'Mark actioned',
    description:
      'Closes the event as handled elsewhere. Actions taken through a case close it automatically.',
    icon: ShieldCheck,
  },
};

export interface ReviewEventControlsProps {
  securityEventId: string;
  reference: string;
  status: EventStatusKey;
  reviewAction: FormAction;
}

/** Review outcomes still possible from the current status; nothing once closed. */
export function ReviewEventControls({
  securityEventId,
  reference,
  status,
  reviewAction,
}: ReviewEventControlsProps) {
  const available = REVIEW_TARGETS[status];
  return (
    <div className={available.length > 0 ? 'flex flex-wrap gap-2' : undefined}>
      {REVIEW_TARGETS.open.map((target) => {
        const copy = REVIEW_COPY[target];
        const shown = available.includes(target);
        return (
          <ConfirmActionDialog
            key={target}
            eyebrow="SECURITY EVENT"
            title={`${copy.label} ${reference}`}
            description={copy.description}
            confirmLabel={copy.label}
            action={reviewAction}
            hidden={{ securityEventId, status: target }}
            trigger={
              <Button
                variant={available[0] === target ? 'primary' : 'secondary'}
                iconLeft={copy.icon}
                data-testid={shown ? `review-${target}` : undefined}
                hidden={!shown}
              >
                {copy.label}
              </Button>
            }
          >
            <FormField
              name="note"
              label="Note"
              description={`Optional. Stored with the review as ${EVENT_STATUS_LABELS[target].toUpperCase()}.`}
            >
              <Textarea name="note" maxLength={TEXT_MAX} rows={3} />
            </FormField>
          </ConfirmActionDialog>
        );
      })}
    </div>
  );
}

export interface RaidModeControlProps {
  enabled: boolean;
  raidAction: FormAction;
}

export function RaidModeControl({ enabled, raidAction }: RaidModeControlProps) {
  return (
    <>
      <ConfirmActionDialog
        eyebrow="SECURITY"
        title="Switch raid mode off"
        description="New joins are no longer held. Members already quarantined stay quarantined until released."
        confirmLabel="Switch off"
        action={raidAction}
        hidden={{ state: 'off' }}
        trigger={
          <Button
            variant="secondary"
            iconLeft={ShieldCheck}
            data-testid={enabled ? 'raid-off' : undefined}
            hidden={!enabled}
          >
            Switch raid mode off
          </Button>
        }
      >
        <ReasonField description="Recorded in the audit log." />
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="SECURITY"
        title="Switch raid mode on"
        description="Every new join is quarantined for review until raid mode is switched off. Staff are alerted and a notice is posted in Discord."
        confirmLabel="Switch on"
        tone="danger"
        action={raidAction}
        hidden={{ state: 'on' }}
        trigger={
          <Button
            variant="danger"
            iconLeft={ShieldAlert}
            data-testid={enabled ? undefined : 'raid-on'}
            hidden={enabled}
          >
            Switch raid mode on
          </Button>
        }
      >
        <ReasonField description="Recorded in the audit log." />
      </ConfirmActionDialog>
    </>
  );
}
