'use client';

import { Shuffle, Swords, Trash2 } from 'lucide-react';
import { Button, IconButton, NativeSelect } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Team sizes offered when drawing (core accepts up to its own maximum). */
const DRAW_SIZES = [1, 2, 3, 4, 5, 6] as const;
const DEFAULT_DRAW_SIZE = 2;

export function DrawTeamsDialog({
  eventId,
  available,
  action,
}: {
  eventId: string;
  /** Members GOING right now (some may already be on a team). */
  available: number;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="TEAMS"
      title="Draw random teams"
      description="Draws teams from GOING members who are not on a team yet. Sizes differ by at most one. The draw is recorded in the audit log."
      confirmLabel="Draw teams"
      action={action}
      hidden={{ eventId }}
      trigger={
        <Button variant="primary" iconLeft={Shuffle} disabled={available === 0}>
          Draw teams
        </Button>
      }
    >
      <FormField name="teamSize" label="Team size">
        <NativeSelect
          name="teamSize"
          defaultValue={String(DEFAULT_DRAW_SIZE)}
          options={DRAW_SIZES.map((size) => ({
            value: String(size),
            label: size === 1 ? 'Solo — teams of 1' : `Teams of ${size}`,
          }))}
        />
      </FormField>
    </ConfirmActionDialog>
  );
}

export function DeleteTeamButton({
  eventId,
  teamId,
  teamName,
  action,
}: {
  eventId: string;
  teamId: string;
  teamName: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="TEAMS"
      title={`Remove ${teamName}`}
      description="The team is dissolved. Its members return to the pool and can be drawn again."
      confirmLabel="Remove team"
      tone="danger"
      action={action}
      hidden={{ eventId, teamId }}
      trigger={<IconButton icon={Trash2} label={`Remove ${teamName}`} size="sm" />}
    />
  );
}

export function GenerateBracketDialog({
  eventId,
  teams,
  action,
}: {
  eventId: string;
  teams: number;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="BRACKET"
      title="Generate bracket"
      description={`Single elimination for ${teams} teams. Teams lock once the bracket exists; byes go to the top seeds.`}
      confirmLabel="Generate bracket"
      action={action}
      hidden={{ eventId }}
      trigger={
        <Button variant="primary" iconLeft={Swords} disabled={teams < 2}>
          Generate bracket
        </Button>
      }
    >
      <FormField name="seeding" label="Seeding">
        <NativeSelect
          name="seeding"
          defaultValue="seeded"
          options={[
            { value: 'seeded', label: 'Seeded — by team seed, then name' },
            { value: 'random', label: 'Random draw' },
          ]}
        />
      </FormField>
    </ConfirmActionDialog>
  );
}
