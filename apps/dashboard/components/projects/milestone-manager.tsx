'use client';

import { Flag, Plus } from 'lucide-react';
import { Button, EmptyState, Input, Mono, NativeSelect, StatusBadge, Textarea } from '@jave/ui';
import {
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_TONE,
  type MilestoneStatusKey,
  milestoneProgress,
} from '@/lib/project-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { InlineAction } from '../forms/inline-action';

export interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatusKey;
  /** Pre-formatted due / completion dates in the viewer's time zone. */
  dueLabel: string | null;
  completedLabel: string | null;
}

export interface MilestoneManagerProps {
  projectId: string;
  milestones: readonly MilestoneRow[];
  canEdit: boolean;
  /** Core's per-project ceiling. */
  max: number;
  actions: { add: FormAction; setStatus: FormAction; complete: FormAction; remove: FormAction };
}

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const PLANNING: readonly MilestoneStatusKey[] = ['planned', 'active', 'dropped'];

function AddMilestoneDialog({ projectId, action }: { projectId: string; action: FormAction }) {
  return (
    <ConfirmActionDialog
      eyebrow="MILESTONES"
      title="Add milestone"
      description="A concrete step toward shipping. Mark it done when it is."
      confirmLabel="Add milestone"
      action={action}
      hidden={{ projectId }}
      trigger={
        <Button variant="secondary" iconLeft={Plus} data-testid="add-milestone">
          Add milestone
        </Button>
      }
    >
      <FormField name="title" label="Milestone" required>
        <Input name="title" required maxLength={TITLE_MAX} placeholder="Static fire test" />
      </FormField>
      <FormField name="description" label="Details">
        <Textarea name="description" rows={3} maxLength={DESCRIPTION_MAX} />
      </FormField>
      <FormField name="dueAt" label="Due date" description="Optional.">
        <Input name="dueAt" type="date" mono />
      </FormField>
    </ConfirmActionDialog>
  );
}

/** Milestones in order, with progress and per-milestone controls for managers. */
export function MilestoneManager({
  projectId,
  milestones,
  canEdit,
  max,
  actions,
}: MilestoneManagerProps) {
  const progress = milestoneProgress(milestones);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-subtle">
          <Mono>
            {progress.done}/{progress.total}
          </Mono>{' '}
          done{milestones.length > 0 ? '' : ' — no milestones yet'}. Dropped milestones do not
          count.
        </p>
        {canEdit && milestones.length < max ? (
          <AddMilestoneDialog projectId={projectId} action={actions.add} />
        ) : null}
      </div>
      {milestones.length === 0 ? (
        <EmptyState
          compact
          icon={Flag}
          title="NO MILESTONES"
          description={
            canEdit
              ? 'Break the work into steps the team can finish.'
              : 'The team has not planned milestones yet.'
          }
        />
      ) : (
        <ol
          aria-label="Milestones"
          className="divide-y divide-line-subtle rounded-lg border border-line bg-surface"
        >
          {milestones.map((milestone, index) => (
            <li
              key={milestone.id}
              data-milestone={milestone.title}
              className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:grid-cols-[28px_minmax(0,1fr)_auto] sm:px-5"
            >
              <Mono dim className="pt-0.5 text-[12px]">
                {String(index + 1).padStart(2, '0')}
              </Mono>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      milestone.status === 'dropped'
                        ? 'text-body text-fg-subtle line-through'
                        : 'text-body text-fg'
                    }
                  >
                    {milestone.title}
                  </span>
                  <StatusBadge
                    tone={MILESTONE_STATUS_TONE[milestone.status]}
                    quiet={milestone.status !== 'active'}
                    label={MILESTONE_STATUS_LABELS[milestone.status].toUpperCase()}
                  />
                </div>
                {milestone.description ? (
                  <p className="whitespace-pre-line text-small text-fg-subtle">
                    {milestone.description}
                  </p>
                ) : null}
                <p className="text-small text-fg-subtle">
                  {milestone.completedLabel ? (
                    <Mono dim className="text-[12px]">
                      done {milestone.completedLabel}
                    </Mono>
                  ) : milestone.dueLabel ? (
                    <Mono dim className="text-[12px]">
                      due {milestone.dueLabel}
                    </Mono>
                  ) : null}
                </p>
              </div>
              {canEdit ? (
                <div className="col-span-2 flex flex-wrap items-start justify-end gap-1 sm:col-span-1">
                  {milestone.status === 'planned' || milestone.status === 'active' ? (
                    <InlineAction
                      action={actions.complete}
                      hidden={{ projectId, milestoneId: milestone.id }}
                      label="Mark done"
                      variant="secondary"
                      data-testid={`complete-milestone-${index}`}
                    />
                  ) : null}
                  <ConfirmActionDialog
                    eyebrow="MILESTONES"
                    title="Set status"
                    description={`Planning status of “${milestone.title}”. Moving a done milestone back reopens it.`}
                    confirmLabel="Set status"
                    action={actions.setStatus}
                    hidden={{ projectId, milestoneId: milestone.id }}
                    trigger={
                      <Button size="sm" variant="ghost">
                        Status
                      </Button>
                    }
                  >
                    <FormField name="status" label="Status" required>
                      <NativeSelect
                        name="status"
                        defaultValue={
                          PLANNING.includes(milestone.status) ? milestone.status : 'active'
                        }
                        options={PLANNING.map((status) => ({
                          value: status,
                          label: MILESTONE_STATUS_LABELS[status],
                        }))}
                      />
                    </FormField>
                  </ConfirmActionDialog>
                  <ConfirmActionDialog
                    eyebrow="MILESTONES"
                    title="Remove milestone"
                    description={`“${milestone.title}” is deleted. Use DROPPED instead to keep the record.`}
                    confirmLabel="Remove milestone"
                    tone="danger"
                    action={actions.remove}
                    hidden={{ projectId, milestoneId: milestone.id }}
                    trigger={
                      <Button size="sm" variant="ghost">
                        Remove
                      </Button>
                    }
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
