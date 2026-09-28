import { ShieldCheck } from 'lucide-react';
import { Badge, Button, EmptyState, Mono, StatusBadge, Textarea } from '@jave/ui';
import type { invites } from '@jave/core';
import {
  anomalyFlagDetail,
  anomalyFlagLabel,
  methodLabel,
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_TONE,
} from '@/lib/referral-labels';
import { formatDate } from '@/lib/time';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const NOTE_MIN = 3;
const NOTE_MAX = 1000;

function NoteField() {
  return (
    <FormField
      name="note"
      label="Reason"
      description="Required. Recorded in the audit log with your verdict."
      required
    >
      <Textarea name="note" required minLength={NOTE_MIN} maxLength={NOTE_MAX} rows={3} />
    </FormField>
  );
}

function FlagList({ flags }: { flags: readonly string[] }) {
  return (
    <ul className="space-y-1.5">
      {flags.map((flag) => (
        <li key={flag} className="text-small text-fg-muted">
          <span className="font-medium text-fg">{anomalyFlagLabel(flag)}</span> —{' '}
          {anomalyFlagDetail(flag)}
        </li>
      ))}
    </ul>
  );
}

function ReviewActions({
  item,
  reviewAction,
}: {
  item: invites.ReferralListItem;
  reviewAction: FormAction;
}) {
  const invitee = item.inviteeName ?? 'this member';
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmActionDialog
        eyebrow="REFERRAL REVIEW"
        title="Clear flags"
        description={`A false positive: the referral of ${invitee} continues its lifecycle and is never flagged again.`}
        confirmLabel="Clear flags"
        action={reviewAction}
        hidden={{ referralId: item.id, decision: 'clear_flags' }}
        trigger={
          <Button size="sm" variant="secondary" data-testid={`clear-${item.id}`}>
            Clear flags
          </Button>
        }
      >
        <FlagList flags={item.anomalyFlags} />
        <NoteField />
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="REFERRAL REVIEW"
        title="Invalidate referral"
        description={`The referral of ${invitee} is removed from every count and can no longer become VALID.`}
        confirmLabel="Invalidate"
        tone="danger"
        action={reviewAction}
        hidden={{ referralId: item.id, decision: 'invalidate' }}
        trigger={
          <Button size="sm" variant="ghost" data-testid={`invalidate-${item.id}`}>
            Invalidate
          </Button>
        }
      >
        <FlagList flags={item.anomalyFlags} />
        <NoteField />
      </ConfirmActionDialog>
    </div>
  );
}

/**
 * Flagged referrals a reviewer can still act on, highest anomaly score first.
 * Nobody reviews a referral they are part of (core refuses and audits it).
 */
export function ReviewQueue({
  items,
  canReview,
  reviewAction,
  timeZone,
}: {
  items: readonly invites.ReferralListItem[];
  canReview: boolean;
  reviewAction: FormAction;
  timeZone: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="QUEUE CLEAR"
        description="No open referral carries an anomaly flag. Flags appear when a join looks inflated: bursts, brand-new accounts, fast leaves, look-alike names."
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle" aria-label="Referrals awaiting review">
      {items.map((item) => (
        <li
          key={item.id}
          data-referral={item.id}
          className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-center"
        >
          <div className="min-w-0 space-y-1">
            <p className="truncate text-body font-medium text-fg">
              {item.inviteeName ?? 'Unlinked Discord user'}
            </p>
            <p className="truncate text-small text-fg-subtle">
              invited by {item.inviterName ?? 'no inviter'} · {methodLabel(item.method)}
            </p>
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={REFERRAL_STATUS_TONE[item.status]}
                label={REFERRAL_STATUS_LABELS[item.status].toUpperCase()}
              />
              <Mono dim className="text-[12px]">
                joined {formatDate(item.joinedAt, timeZone)}
              </Mono>
            </p>
          </div>
          <div className="min-w-0 space-y-2">
            <p className="flex flex-wrap gap-1.5">
              {item.anomalyFlags.map((flag) => (
                <Badge key={flag} tone="warning" title={anomalyFlagDetail(flag)}>
                  {anomalyFlagLabel(flag)}
                </Badge>
              ))}
            </p>
            <p className="text-small text-fg-subtle">
              Anomaly score <Mono className="text-fg">{item.anomalyScore}</Mono> / 100
            </p>
          </div>
          {canReview ? <ReviewActions item={item} reviewAction={reviewAction} /> : null}
        </li>
      ))}
    </ul>
  );
}
