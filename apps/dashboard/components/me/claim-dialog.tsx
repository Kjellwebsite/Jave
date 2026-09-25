'use client';

import { Button, Input, NativeSelect, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const WITHDRAW = '';

export function ClaimDialog({
  facetKey,
  facetLabel,
  claimedRank,
  tiers,
  action,
}: {
  facetKey: string;
  facetLabel: string;
  claimedRank: string | null;
  tiers: readonly string[];
  action: FormAction;
}) {
  const options = [
    ...[...tiers].reverse().map((tier) => ({ value: tier, label: `${tier} — claimed` })),
    { value: WITHDRAW, label: 'Withdraw claim', disabled: claimedRank === null },
  ];
  return (
    <ConfirmActionDialog
      eyebrow={`CLAIM · ${facetLabel.toUpperCase()}`}
      title="Claim a rank"
      description="A claim is self-reported and always shown as CLAIMED. It never changes a verified rank — evidence helps an evaluator verify it."
      confirmLabel="Record claim"
      action={action}
      hidden={{ facetKey }}
      trigger={
        <Button size="sm" variant="secondary" data-testid={`claim-${facetKey}`}>
          {claimedRank ? 'Update claim' : 'Claim'}
        </Button>
      }
    >
      <FormField name="rank" label="Claimed rank" required>
        <NativeSelect name="rank" defaultValue={claimedRank ?? tiers[0] ?? ''} options={options} />
      </FormField>
      <FormField
        name="evidence.title"
        label="Evidence title"
        description="Optional. A project, result or publication."
      >
        <Input name="evidenceTitle" maxLength={200} />
      </FormField>
      <FormField name="evidence.url" label="Evidence link" description="http(s) only.">
        <Input
          name="evidenceUrl"
          type="url"
          inputMode="url"
          maxLength={2048}
          placeholder="https://"
        />
      </FormField>
      <FormField name="evidence.description" label="Evidence notes">
        <Textarea name="evidenceDescription" maxLength={2000} rows={3} />
      </FormField>
    </ConfirmActionDialog>
  );
}
