'use client';

import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Button, Input, Mono, NativeSelect, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { TRIAL_LIMITS } from '@/lib/trial-limits';
import type { ScoreTarget } from '@/lib/trial-scoring';

export interface ScoreCriterion {
  key: string;
  label: string;
  description: string;
  weight: number;
  weightPercent: number;
}

export type { ScoreTarget };

export interface ScoreDialogProps {
  trialId: string;
  teamName: string;
  criteria: readonly ScoreCriterion[];
  targets: readonly ScoreTarget[];
  action: FormAction;
}

const { scoreMin: SCORE_MIN, scoreMax: SCORE_MAX, notes: NOTES_MAX } = TRIAL_LIMITS;
const PREVIEW_DIGITS = 2;

/**
 * Live preview of Σ(weight·score)/Σ(weight) while typing. Display only: the
 * trials service computes and stores the recorded score.
 */
function previewTotal(criteria: readonly ScoreCriterion[], values: Record<string, string>) {
  let weighted = 0;
  let total = 0;
  for (const criterion of criteria) {
    const raw = values[criterion.key];
    const score = raw === undefined || raw === '' ? Number.NaN : Number(raw);
    if (!Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) return null;
    weighted += criterion.weight * score;
    total += criterion.weight;
  }
  return total > 0 ? (weighted / total).toFixed(PREVIEW_DIGITS) : null;
}

function initialValues(target: ScoreTarget | undefined): Record<string, string> {
  const scores = target?.previous?.scores ?? {};
  return Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, String(value)]));
}

/** Score a team (or one of its members) on every criterion, 0–10 whole numbers. */
export function ScoreDialog({ trialId, teamName, criteria, targets, action }: ScoreDialogProps) {
  const [target, setTarget] = useState(targets[0]?.value ?? '');
  const current = targets.find((candidate) => candidate.value === target);
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(targets[0]));
  const total = previewTotal(criteria, values);

  function pick(value: string) {
    setTarget(value);
    setValues(initialValues(targets.find((candidate) => candidate.value === value)));
  }

  return (
    <ConfirmActionDialog
      eyebrow={`EVALUATION · ${teamName}`}
      title="Record scores"
      description="Score every criterion 0–10. Re-scoring replaces your earlier evaluation of the same target. Late work is flagged; judge it — there is no automatic penalty."
      confirmLabel="Record scores"
      action={action}
      hidden={{ trialId }}
      trigger={
        <Button size="sm" iconLeft={ClipboardCheck} data-testid={`score-${teamName}`}>
          Score
        </Button>
      }
    >
      <FormField name="target" label="Scoring" required>
        <NativeSelect
          name="target"
          value={target}
          onChange={(event) => pick(event.target.value)}
          options={targets.map((candidate) => ({ value: candidate.value, label: candidate.label }))}
        />
      </FormField>
      <div key={target} className="space-y-4">
        {criteria.map((criterion) => (
          <FormField
            key={criterion.key}
            name={`score:${criterion.key}`}
            label={`${criterion.label} · ${criterion.weightPercent}%`}
            description={criterion.description || undefined}
            required
          >
            <Input
              name={`score:${criterion.key}`}
              type="number"
              inputMode="numeric"
              min={SCORE_MIN}
              max={SCORE_MAX}
              step={1}
              required
              mono
              value={values[criterion.key] ?? ''}
              onChange={(event) =>
                setValues((previous) => ({ ...previous, [criterion.key]: event.target.value }))
              }
              className="w-24"
            />
          </FormField>
        ))}
        <FormField
          name="notes"
          label="Notes"
          description="Staff only. Never shown to participants."
        >
          <Textarea
            name="notes"
            maxLength={NOTES_MAX}
            rows={3}
            defaultValue={current?.previous?.notes ?? ''}
          />
        </FormField>
      </div>
      <p className="flex items-baseline justify-between border-t border-line-subtle pt-3 text-small text-fg-subtle">
        <span>Weighted (preview)</span>
        <Mono className="text-[18px] text-fg" data-testid="weighted-preview">
          {total ?? '—'}
        </Mono>
      </p>
    </ConfirmActionDialog>
  );
}
