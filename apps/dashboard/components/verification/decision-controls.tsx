'use client';

import { Check, RotateCcw, ScanSearch, X } from 'lucide-react';
import { Button, NativeSelect, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Browser-side hint only; the services enforce the real minimum. */
const TEXT_MIN = 3;

export type VerificationControlName = 'start_review' | 'approve' | 'reject' | 'revoke';

export interface VerificationDecisionControlsProps {
  verificationId: string;
  reference: string;
  /** What an approval would verify, e.g. `SKILL · Mind · Research at A`. */
  target: string;
  /** What an approval changes for this type. */
  consequence: string;
  controls: readonly VerificationControlName[];
  /** Skill approvals: the ranks a verifier may grant, highest first, and the requested one. */
  skill: { tiers: readonly string[]; requested: string | null } | null;
  /** core's verification TEXT_LIMITS for the decision note and the revocation reason. */
  limits: { note: number; reason: number };
  actions: { startReview: FormAction; decide: FormAction; revoke: FormAction };
}

export function VerificationDecisionControls({
  verificationId,
  reference,
  target,
  consequence,
  controls,
  skill,
  limits,
  actions,
}: VerificationDecisionControlsProps) {
  const hidden = { verificationId };
  const has = (control: VerificationControlName) => controls.includes(control);
  return (
    <div className="flex flex-wrap gap-2" data-testid="verification-actions">
      {has('start_review') ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Start review"
          description="Assigns this verification to you. From then on only you can decide it, until it is reassigned."
          confirmLabel="Start review"
          action={actions.startReview}
          hidden={hidden}
          trigger={
            <Button variant="secondary" iconLeft={ScanSearch}>
              Start review
            </Button>
          }
        />
      ) : null}
      {has('approve') ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Approve"
          description={`Verifies ${target}. ${consequence} The member is notified and sees your note.`}
          confirmLabel="Approve verification"
          action={actions.decide}
          hidden={{ ...hidden, decision: 'approve' }}
          trigger={
            <Button variant="primary" iconLeft={Check}>
              Approve
            </Button>
          }
        >
          {skill ? (
            <FormField
              name="grantedRank"
              label="Rank to grant"
              description={`Requested ${skill.requested ?? '—'}. Must be above the current verified rank.`}
              required
            >
              <NativeSelect
                name="grantedRank"
                defaultValue={skill.requested ?? skill.tiers[0] ?? ''}
                options={skill.tiers.map((tier) => ({ value: tier, label: tier }))}
              />
            </FormField>
          ) : null}
          <FormField
            name="note"
            label="Decision note"
            description="Required. The member sees it."
            required
          >
            <Textarea name="note" required minLength={TEXT_MIN} maxLength={limits.note} rows={3} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {has('reject') ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Reject"
          description="Closes the request as not proven. Nothing else changes: not proven is not false. The member may request again."
          confirmLabel="Reject verification"
          tone="danger"
          action={actions.decide}
          hidden={{ ...hidden, decision: 'reject' }}
          trigger={
            <Button variant="secondary" iconLeft={X}>
              Reject
            </Button>
          }
        >
          <FormField
            name="note"
            label="Why it is not verified"
            description="Required. The member sees it."
            required
          >
            <Textarea name="note" required minLength={TEXT_MIN} maxLength={limits.note} rows={3} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {has('revoke') ? (
        <ConfirmActionDialog
          eyebrow={reference}
          title="Revoke approval"
          description="Reverses exactly what this approval changed, where it still stands. The member is notified and sees the reason."
          confirmLabel="Revoke verification"
          tone="danger"
          action={actions.revoke}
          hidden={hidden}
          trigger={
            <Button variant="secondary" iconLeft={RotateCcw}>
              Revoke
            </Button>
          }
        >
          <FormField
            name="reason"
            label="Reason"
            description="Required. The member sees it."
            required
          >
            <Textarea
              name="reason"
              required
              minLength={TEXT_MIN}
              maxLength={limits.reason}
              rows={3}
            />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
    </div>
  );
}
