'use client';

import { Button, Input, NativeSelect } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

export interface ReportMatchDialogProps {
  matchId: string;
  roundName: string;
  teamA: string;
  teamB: string;
  scoreMax: number;
  action: FormAction;
  /** Keep the dialog mounted but offer no button (the match is not ready or is decided). */
  triggerHidden?: boolean;
}

/** Staff: record a match result. Final once recorded; the winner advances at once. */
export function ReportMatchDialog({
  matchId,
  roundName,
  teamA,
  teamB,
  scoreMax,
  action,
  triggerHidden = false,
}: ReportMatchDialogProps) {
  const scoreDigits = String(scoreMax).length;
  return (
    <ConfirmActionDialog
      eyebrow={`BRACKET · ${roundName.toUpperCase()}`}
      title={`${teamA} vs ${teamB}`}
      description="Results are final once recorded. Leave both scores blank for a forfeit and choose the winner."
      confirmLabel="Record result"
      action={action}
      hidden={{ matchId }}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          data-testid="report-match"
          className={triggerHidden ? 'hidden' : undefined}
        >
          Report
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <FormField name="scoreA" label={teamA}>
          <Input
            name="scoreA"
            type="number"
            inputMode="numeric"
            min={0}
            max={scoreMax}
            step={1}
            maxLength={scoreDigits}
            mono
          />
        </FormField>
        <FormField name="scoreB" label={teamB}>
          <Input
            name="scoreB"
            type="number"
            inputMode="numeric"
            min={0}
            max={scoreMax}
            step={1}
            maxLength={scoreDigits}
            mono
          />
        </FormField>
      </div>
      <FormField
        name="winner"
        label="Winner"
        description="By score unless it was a forfeit or a tied score."
      >
        <NativeSelect
          name="winner"
          defaultValue="score"
          options={[
            { value: 'score', label: 'By score' },
            { value: 'a', label: `${teamA} wins` },
            { value: 'b', label: `${teamB} wins` },
          ]}
        />
      </FormField>
    </ConfirmActionDialog>
  );
}
