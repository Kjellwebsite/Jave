'use client';

import { useRef, useState } from 'react';
import { Award, BadgeX } from 'lucide-react';
import { Button, NativeSelect, Textarea } from '@jave/ui';
import type { AchievementOption, HeldAwardsResult, HeldAwardView } from '@/lib/achievement-labels';
import { ACHIEVEMENT_FORM_LIMITS } from '@/lib/form-limits';
import type { MemberOption, MemberSearch } from '@/lib/member-search';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { MemberPicker } from '../forms/member-picker';

const { reasonMin: REASON_MIN, reasonMax: REASON_MAX } = ACHIEVEMENT_FORM_LIMITS;

type HeldState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; held: readonly HeldAwardView[] }
  | { status: 'error'; message: string };

export interface AwardDialogsProps {
  /** Active achievements staff may award. */
  options: readonly AchievementOption[];
  search: MemberSearch;
  initial: readonly MemberOption[];
  lookup: (memberId: string) => Promise<HeldAwardsResult>;
  awardAction: FormAction;
  revokeAction: FormAction;
}

/**
 * The award and revoke forms: pick a member, then an achievement they lack
 * (award) or hold (revoke), with a required reason. The service re-checks
 * everything, including that nobody acts on their own achievements.
 */
function AwardFields({
  mode,
  options,
  search,
  initial,
  lookup,
}: Omit<AwardDialogsProps, 'awardAction' | 'revokeAction'> & { mode: 'award' | 'revoke' }) {
  const [held, setHeld] = useState<HeldState>({ status: 'none' });
  const latest = useRef(0);

  function memberChanged(selected: readonly MemberOption[]) {
    const request = ++latest.current;
    const [member] = selected;
    if (!member) {
      setHeld({ status: 'none' });
      return;
    }
    setHeld({ status: 'loading' });
    lookup(member.memberId)
      .then((result) => {
        if (request !== latest.current) return;
        setHeld(
          result.status === 'ok'
            ? { status: 'ready', held: result.held }
            : { status: 'error', message: result.message },
        );
      })
      .catch(() => {
        if (request === latest.current)
          setHeld({ status: 'error', message: 'Their awards could not be loaded. Try again.' });
      });
  }

  const ready = held.status === 'ready';
  const heldKeys = new Set(ready ? held.held.map((award) => award.key) : []);
  const choices =
    mode === 'award'
      ? options.filter((option) => !heldKeys.has(option.value))
      : ready
        ? held.held.map((award) => ({
            value: award.key,
            label: award.verified ? award.title : `${award.title} · pending verification`,
          }))
        : [];
  const hint =
    held.status === 'none'
      ? 'Choose a member first.'
      : held.status === 'loading'
        ? 'Loading their awards…'
        : held.status === 'error'
          ? held.message
          : choices.length === 0
            ? mode === 'award'
              ? 'They hold every active achievement.'
              : 'They hold no achievements.'
            : mode === 'award'
              ? 'Active achievements they do not hold.'
              : 'Achievements they hold.';

  return (
    <>
      <MemberPicker
        name="memberId"
        legend="Member"
        description="Present in the guild. Search by name or handle."
        search={search}
        initial={initial}
        onChange={memberChanged}
      />
      <FormField name="key" label="Achievement" description={hint} required>
        <NativeSelect
          name="key"
          required
          disabled={!ready || choices.length === 0}
          placeholder={ready && choices.length > 0 ? 'Choose an achievement' : '—'}
          options={choices}
        />
      </FormField>
      <FormField
        name="reason"
        label="Reason"
        description={
          mode === 'award'
            ? 'Required. Recorded in the audit log.'
            : 'Required. The member is told it was revoked.'
        }
        required
      >
        <Textarea name="reason" required minLength={REASON_MIN} maxLength={REASON_MAX} rows={3} />
      </FormField>
    </>
  );
}

/** Manual award and revocation. Nobody acts on their own achievements; the service enforces it. */
export function AwardControls({ awardAction, revokeAction, ...fields }: AwardDialogsProps) {
  return (
    <>
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
        <AwardFields mode="award" {...fields} />
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
        <AwardFields mode="revoke" {...fields} />
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
        <Button size="sm" variant="secondary">
          Verify
        </Button>
      }
    />
  );
}
