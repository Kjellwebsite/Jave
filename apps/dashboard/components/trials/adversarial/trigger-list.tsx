import { Check, Crosshair, Undo2 } from 'lucide-react';
import type { adversarial } from '@jave/core';
import { Badge, Button, Checkbox, Mono } from '@jave/ui';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../../forms/action-form';
import { ConfirmActionDialog } from '../../forms/confirm-action-dialog';

export interface TriggerActions {
  approve: FormAction;
  withdraw: FormAction;
  fire: FormAction;
}

export interface TriggerListProps {
  trialId: string;
  roleId: string;
  triggers: readonly adversarial.TriggerRecord[];
  /** Triggers can still be approved or withdrawn (the role is planned, briefed or active). */
  editable: boolean;
  /** The role was authorized: later triggers need their own second-person approval. */
  roleAuthorized: boolean;
  /** The exercise is active: approved triggers can be marked fired. */
  exerciseActive: boolean;
  viewerUserId: string;
  canAuthorize: boolean;
  timeZone: string;
  actions: TriggerActions;
}

type TriggerState = 'fired' | 'approved' | 'pending' | 'in-plan';

function triggerState(trigger: adversarial.TriggerRecord, roleAuthorized: boolean): TriggerState {
  if (trigger.firedAt) return 'fired';
  if (trigger.approvedAt) return 'approved';
  // Before authorization every trigger is part of the plan under review.
  return roleAuthorized ? 'pending' : 'in-plan';
}

const STATE_BADGE: Record<
  TriggerState,
  { tone: 'info' | 'success' | 'warning' | 'neutral'; label: string }
> = {
  fired: { tone: 'info', label: 'Fired' },
  approved: { tone: 'success', label: 'Approved' },
  pending: { tone: 'warning', label: 'Awaiting approval' },
  'in-plan': { tone: 'neutral', label: 'In plan' },
};

/**
 * A role's planned beats. Triggers added after authorization stay pending —
 * invisible to the operative — until a second person approves them; pending
 * ones can be withdrawn; approved ones are part of the signed plan. The
 * adversarial service enforces every one of these rules again.
 */
export function TriggerList({
  trialId,
  roleId,
  triggers,
  editable,
  roleAuthorized,
  exerciseActive,
  viewerUserId,
  canAuthorize,
  timeZone,
  actions,
}: TriggerListProps) {
  if (triggers.length === 0) return <p className="mt-1 text-small text-fg-subtle">None planned.</p>;
  return (
    <ul className="mt-2 space-y-2">
      {triggers.map((trigger) => {
        const state = triggerState(trigger, roleAuthorized);
        const badge = STATE_BADGE[state];
        const hidden = { trialId, roleId, triggerId: trigger.id };
        const authoredByViewer = trigger.createdByUserId === viewerUserId;
        return (
          <li
            key={trigger.id}
            data-trigger={state}
            className="rounded-md border border-line px-3 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-small font-medium text-fg">{trigger.label}</span>
                <Badge tone={badge.tone}>{badge.label}</Badge>
                {trigger.firedAt ? (
                  <Mono dim className="text-[12px]">
                    {formatTimestamp(trigger.firedAt, timeZone)}
                  </Mono>
                ) : trigger.plannedFor ? (
                  <Mono dim className="text-[12px]">
                    planned {formatTimestamp(trigger.plannedFor, timeZone)}
                  </Mono>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {state === 'pending' && editable && canAuthorize && !authoredByViewer ? (
                  <ConfirmActionDialog
                    eyebrow="TWO-PERSON RULE"
                    title="Approve trigger"
                    description="You are the second person for this trigger. A briefed operative receives the updated briefing."
                    confirmLabel="Approve trigger"
                    action={actions.approve}
                    hidden={hidden}
                    trigger={
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft={Check}
                        data-testid="approve-trigger"
                      >
                        Approve
                      </Button>
                    }
                  >
                    <Checkbox
                      id={`attest-trigger-${trigger.id}`}
                      name="sandboxAttested"
                      label="I attest: fictional data and sandbox accounts only"
                      description="No real credentials, personal data, outside people or external systems."
                    />
                  </ConfirmActionDialog>
                ) : null}
                {state === 'pending' && editable && authoredByViewer ? (
                  <span className="text-small text-fg-subtle">
                    You wrote it: another authorizer approves.
                  </span>
                ) : null}
                {(state === 'pending' || state === 'in-plan') && editable ? (
                  <ConfirmActionDialog
                    eyebrow="ADVERSARIAL"
                    title="Withdraw trigger"
                    description="It never reached the operative. Before authorization, withdrawing changes the plan under review."
                    confirmLabel="Withdraw trigger"
                    tone="danger"
                    action={actions.withdraw}
                    hidden={hidden}
                    trigger={
                      <Button size="sm" variant="ghost" iconLeft={Undo2}>
                        Withdraw
                      </Button>
                    }
                  />
                ) : null}
                {state === 'approved' && exerciseActive ? (
                  <ConfirmActionDialog
                    eyebrow="ADVERSARIAL"
                    title="Mark trigger fired"
                    description="Records that the operative carried out this beat. Each trigger fires once."
                    confirmLabel="Mark fired"
                    action={actions.fire}
                    hidden={hidden}
                    trigger={
                      <Button size="sm" variant="ghost" iconLeft={Crosshair}>
                        Mark fired
                      </Button>
                    }
                  />
                ) : null}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-small text-fg-subtle">
              {trigger.description}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
