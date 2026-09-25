'use client';

import { NotebookPen, ShieldCheck } from 'lucide-react';
import { IconButton, NativeSelect, Textarea } from '@jave/ui';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import type { FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export interface EvidenceOption {
  id: string;
  title: string;
}

export interface EvaluatorControlsProps {
  memberId: string;
  memberName: string;
  facetKey: string;
  facetLabel: string;
  verifiedRank: string | null;
  /** The member's claim (if visible), used as the starting suggestion. */
  claimedRank: string | null;
  notes: string | null;
  tiers: readonly string[];
  evidence: readonly EvidenceOption[];
  setRankAction: FormAction;
  notesAction: FormAction;
}

const CLEAR = '';

/** Evaluator tools for one facet: set/clear the VERIFIED rank, and staff notes. */
export function EvaluatorControls({
  memberId,
  memberName,
  facetKey,
  facetLabel,
  verifiedRank,
  claimedRank,
  notes,
  tiers,
  evidence,
  setRankAction,
  notesAction,
}: EvaluatorControlsProps) {
  const rankOptions = [
    ...[...tiers].reverse().map((tier) => ({ value: tier, label: `${tier} — verified` })),
    { value: CLEAR, label: 'Clear verified rank', disabled: verifiedRank === null },
  ];
  return (
    <div className="flex items-center gap-0.5">
      <ConfirmActionDialog
        eyebrow={`EVALUATE · ${facetLabel.toUpperCase()}`}
        title="Set verified rank"
        description={`Sets ${memberName}’s VERIFIED ${facetLabel} rank. Every change is recorded in rank history and the audit log.`}
        confirmLabel="Set verified rank"
        action={setRankAction}
        hidden={{ memberId, facetKey }}
        trigger={
          <IconButton
            icon={ShieldCheck}
            label={`Set verified ${facetLabel} rank`}
            size="sm"
            data-testid={`set-rank-${facetKey}`}
          />
        }
      >
        <FormField name="rank" label="Verified rank" required>
          <NativeSelect
            name="rank"
            defaultValue={verifiedRank ?? claimedRank ?? tiers[0] ?? ''}
            options={rankOptions}
          />
        </FormField>
        <FormField
          name="reason"
          label="Reason"
          description="Required. What was demonstrated, and how you know."
          required
        >
          <Textarea name="reason" required minLength={3} maxLength={2000} rows={3} />
        </FormField>
        {evidence.length > 0 ? (
          <FormField
            name="evidenceId"
            label="Evidence"
            description="Optional. Accepted evidence is marked as reviewed."
          >
            <NativeSelect
              name="evidenceId"
              defaultValue=""
              placeholder="No evidence attached"
              options={evidence.map((item) => ({ value: item.id, label: item.title }))}
            />
          </FormField>
        ) : null}
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow={`EVALUATE · ${facetLabel.toUpperCase()}`}
        title="Evaluator notes"
        description="Visible to evaluators only. Never shown to the member."
        confirmLabel="Save notes"
        action={notesAction}
        hidden={{ memberId, facetKey }}
        trigger={
          <IconButton
            icon={NotebookPen}
            label={`Evaluator notes for ${facetLabel}`}
            size="sm"
            className={notes ? 'text-fg' : undefined}
          />
        }
      >
        <FormField name="notes" label="Notes">
          <Textarea name="notes" defaultValue={notes ?? ''} maxLength={4000} rows={5} />
        </FormField>
      </ConfirmActionDialog>
    </div>
  );
}
