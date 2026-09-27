import { Plus } from 'lucide-react';
import { Button, Input, Textarea } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Mirrors core's campaign limits (core re-validates everything). */
const KEY_MAX = 48;
const NAME_MIN = 2;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;

export interface CampaignFieldDefaults {
  name?: string;
  description?: string;
  /** 'YYYY-MM-DD' (UTC day) or ''. */
  startsAt?: string;
  /** Inclusive end day, 'YYYY-MM-DD' (UTC) or ''. */
  endsAt?: string;
}

/** Campaign inputs shared by the create dialog and the edit form. */
export function CampaignFields({
  defaults = {},
  withKey,
}: {
  defaults?: CampaignFieldDefaults;
  /** The key is set once, at creation. */
  withKey: boolean;
}) {
  return (
    <>
      {withKey ? (
        <FormField
          name="key"
          label="Key"
          description="2–48 lowercase letters, digits or dashes. Permanent."
          required
        >
          <Input
            name="key"
            required
            maxLength={KEY_MAX}
            autoComplete="off"
            spellCheck={false}
            mono
          />
        </FormField>
      ) : null}
      <FormField name="name" label="Name" required>
        <Input
          name="name"
          required
          minLength={NAME_MIN}
          maxLength={NAME_MAX}
          defaultValue={defaults.name}
        />
      </FormField>
      <FormField name="description" label="Description" description="Staff-facing. Optional.">
        <Textarea
          name="description"
          maxLength={DESCRIPTION_MAX}
          rows={3}
          defaultValue={defaults.description}
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="startsAt" label="Starts (UTC)" description="Empty: immediately.">
          <Input name="startsAt" type="date" defaultValue={defaults.startsAt} />
        </FormField>
        <FormField name="endsAt" label="Ends (UTC, inclusive)" description="Empty: open-ended.">
          <Input name="endsAt" type="date" defaultValue={defaults.endsAt} />
        </FormField>
      </div>
    </>
  );
}

/** "New campaign" → a dialog; success closes it and announces the result. */
export function NewCampaignDialog({ action }: { action: FormAction }) {
  return (
    <ConfirmActionDialog
      eyebrow="REFERRALS"
      title="New campaign"
      description="Joins through its invites and codes are credited while it is active and inside its window. Nothing is rewritten retroactively."
      confirmLabel="Create campaign"
      action={action}
      trigger={
        <Button variant="primary" iconLeft={Plus} data-testid="new-campaign">
          New campaign
        </Button>
      }
    >
      <CampaignFields withKey />
    </ConfirmActionDialog>
  );
}
