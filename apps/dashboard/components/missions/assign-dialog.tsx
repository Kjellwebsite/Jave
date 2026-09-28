'use client';

import { UserPlus } from 'lucide-react';
import { Button, Input } from '@jave/ui';
import { MISSION_FORM_LIMITS } from '@/lib/form-limits';
import type { MemberOption, MemberSearch } from '@/lib/member-search';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { MemberPicker } from '../forms/member-picker';

const {
  assignBatchMax: MAX_BATCH,
  teamKeyMax: TEAM_KEY_MAX,
  durationHoursMax,
} = MISSION_FORM_LIMITS;

/** Assign members to an open mission. The service skips anyone who cannot take it and says why. */
export function AssignDialog({
  missionId,
  headline,
  team,
  slotsLeft,
  initial,
  unavailable,
  search,
  action,
}: {
  missionId: string;
  headline: string;
  team: boolean;
  /** Null when uncapped. */
  slotsLeft: number | null;
  /** First members offered before any search. */
  initial: readonly MemberOption[];
  /** Members already holding the mission, with their state. */
  unavailable: Readonly<Record<string, string>>;
  search: MemberSearch;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="MISSIONS"
      title="Assign members"
      description={
        slotsLeft === 0
          ? `${headline}. Every slot is taken: raise the cap in Edit first, or members are skipped.`
          : `${headline}. Members are notified and accept before they start. You cannot assign yourself.`
      }
      confirmLabel="Assign"
      action={action}
      hidden={{ missionId }}
      trigger={
        <Button variant="primary" iconLeft={UserPlus} data-testid="assign-members">
          Assign
        </Button>
      }
    >
      <MemberPicker
        name="memberId"
        errorKey="memberIds"
        legend="Members"
        description="Present in the guild. Search by name or handle."
        search={search}
        initial={initial}
        max={MAX_BATCH}
        unavailable={unavailable}
      />
      {team ? (
        <FormField
          name="teamKey"
          label="Team key"
          description="1–32 characters: a–z, 0–9, - or _. Members sharing it submit together."
          required
        >
          <Input name="teamKey" required maxLength={TEAM_KEY_MAX} placeholder="team-1" mono />
        </FormField>
      ) : null}
      <FormField
        name="durationHours"
        label="Time limit (hours)"
        description="Overrides the mission default for these members. Blank keeps it."
      >
        <Input
          name="durationHours"
          type="number"
          inputMode="numeric"
          min={1}
          max={durationHoursMax}
        />
      </FormField>
    </ConfirmActionDialog>
  );
}
