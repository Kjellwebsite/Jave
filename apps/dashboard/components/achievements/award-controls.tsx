'use client';

import { useId } from 'react';
import { Award, BadgeX } from 'lucide-react';
import { Button, Input, NativeSelect, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

const HANDLE_MAX = 32;
const REASON_MIN = 3;
const REASON_MAX = 500;

export interface AchievementOption {
  value: string;
  label: string;
}

function MemberField({ listId }: { listId: string }) {
  return (
    <FormField name="handle" label="Member" description="Their handle, e.g. @mara." required>
      <Input
        name="handle"
        required
        maxLength={HANDLE_MAX + 1}
        list={listId}
        autoComplete="off"
        placeholder="@handle"
        mono
      />
    </FormField>
  );
}

function ReasonField({ description }: { description: string }) {
  return (
    <FormField name="reason" label="Reason" description={description} required>
      <Textarea name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={3} />
    </FormField>
  );
}

/** Manual award and revocation. Nobody acts on their own achievements; the service enforces it. */
export function AwardControls({
  options,
  handles,
  awardAction,
  revokeAction,
}: {
  options: readonly AchievementOption[];
  /** Member handles offered as suggestions (the field accepts any handle). */
  handles: readonly string[];
  awardAction: FormAction;
  revokeAction: FormAction;
}) {
  const listId = `${useId()}-handles`;
  return (
    <>
      <datalist id={listId}>
        {handles.map((handle) => (
          <option key={handle} value={`@${handle}`} />
        ))}
      </datalist>
      <ConfirmActionDialog
        eyebrow="ACHIEVEMENTS"
        title="Award achievement"
        description="Recorded with your reason. The member is notified; public achievements are announced once verified."
        confirmLabel="Award"
        action={awardAction}
        trigger={
          <Button variant="secondary" iconLeft={Award} data-testid="award-achievement">
            Award
          </Button>
        }
      >
        <MemberField listId={listId} />
        <FormField name="key" label="Achievement" required>
          <NativeSelect name="key" options={options} />
        </FormField>
        <ReasonField description="Required. Recorded in the audit log." />
      </ConfirmActionDialog>
      <ConfirmActionDialog
        eyebrow="ACHIEVEMENTS"
        title="Revoke achievement"
        description="The award is kept in history as revoked, its public card is removed, and rules never re-award it."
        confirmLabel="Revoke"
        tone="danger"
        action={revokeAction}
        trigger={
          <Button variant="ghost" iconLeft={BadgeX} data-testid="revoke-achievement">
            Revoke
          </Button>
        }
      >
        <MemberField listId={listId} />
        <FormField name="key" label="Achievement" required>
          <NativeSelect name="key" options={options} />
        </FormField>
        <ReasonField description="Required. The member is told it was revoked." />
      </ConfirmActionDialog>
    </>
  );
}

/** VERIFY for one pending award. */
export function VerifyAwardButton({
  memberId,
  achievementKey,
  label,
  action,
}: {
  memberId: string;
  achievementKey: string;
  label: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="ACHIEVEMENTS"
      title="Verify award"
      description={`${label}. Verifying makes it count and announces it where enabled. You cannot verify an award you made or hold.`}
      confirmLabel="Verify award"
      action={action}
      hidden={{ memberId, key: achievementKey }}
      trigger={
        <Button size="sm" variant="primary">
          Verify
        </Button>
      }
    />
  );
}
