'use client';

import { ArrowRightLeft } from 'lucide-react';
import { Button, Callout, NativeSelect } from '@jave/ui';
import { PROJECT_STATUS_LABELS, type ProjectStatusKey } from '@/lib/project-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface StatusControlProps {
  projectId: string;
  projectTitle: string;
  current: ProjectStatusKey;
  /** Allowed next statuses (from the core transition table), archiving excluded. */
  targets: readonly ProjectStatusKey[];
  /** True once the project has shipped: shipping again credits nobody twice. */
  shippedBefore: boolean;
  action: FormAction;
}

/** Move the project along its lifecycle. Core re-checks the transition and the actor. */
export function StatusControl({
  projectId,
  projectTitle,
  current,
  targets,
  shippedBefore,
  action,
}: StatusControlProps) {
  if (targets.length === 0) return null;
  const preferred = targets.find((target) => target !== 'idea' && target !== 'planning');
  return (
    <ConfirmActionDialog
      eyebrow="LIFECYCLE"
      title="Change status"
      description={`${projectTitle} is ${PROJECT_STATUS_LABELS[current].toUpperCase()}. The team is notified of the change.`}
      confirmLabel="Change status"
      action={action}
      hidden={{ projectId }}
      trigger={
        <Button variant="primary" iconLeft={ArrowRightLeft} data-testid="change-status">
          Change status
        </Button>
      }
    >
      <FormField name="status" label="New status" required>
        <NativeSelect
          name="status"
          defaultValue={preferred ?? targets[0]}
          options={targets.map((target) => ({
            value: target,
            label: PROJECT_STATUS_LABELS[target],
          }))}
        />
      </FormField>
      {targets.includes('shipped') ? (
        <Callout tone="info">
          {shippedBefore
            ? 'Shipping again marks a new iteration. Credit was already given on the first ship.'
            : 'Shipping credits every active member once and stamps the ship date. Declare it when it is real.'}
        </Callout>
      ) : null}
    </ConfirmActionDialog>
  );
}
