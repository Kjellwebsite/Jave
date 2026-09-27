import { Link2, Trash2, Unlink } from 'lucide-react';
import { Button, NativeSelect } from '@jave/ui';
import type { invites } from '@jave/core';
import { ActionForm, type FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { CampaignFields, type CampaignFieldDefaults } from './campaign-fields';

/** Characters of an inviter's name shown in the attach picker. */
const PICKER_NAME_MAX = 40;

export function CampaignEditForm({
  campaignId,
  defaults,
  action,
}: {
  campaignId: string;
  defaults: CampaignFieldDefaults;
  action: FormAction;
}) {
  return (
    <ActionForm action={action} submitLabel="Save campaign" aria-label="Campaign settings">
      <input type="hidden" name="campaignId" value={campaignId} />
      <CampaignFields withKey={false} defaults={defaults} />
    </ActionForm>
  );
}

export function CampaignActiveToggle({
  campaign,
  action,
}: {
  campaign: Pick<invites.CampaignView, 'id' | 'key' | 'active'>;
  action: FormAction;
}) {
  const activating = !campaign.active;
  return (
    <ConfirmActionDialog
      eyebrow="CAMPAIGN"
      title={activating ? 'Activate campaign' : 'Deactivate campaign'}
      description={
        activating
          ? `Joins through ${campaign.key}’s invites and codes are credited again while inside its window.`
          : `New joins stop crediting ${campaign.key}. Past referrals keep their credit.`
      }
      confirmLabel={activating ? 'Activate' : 'Deactivate'}
      tone={activating ? 'default' : 'danger'}
      action={action}
      hidden={{ campaignId: campaign.id, active: activating ? 'true' : 'false' }}
      trigger={
        <Button variant="secondary" data-testid="campaign-active-toggle">
          {activating ? 'Activate' : 'Deactivate'}
        </Button>
      }
    />
  );
}

export function DetachInviteButton({
  campaignId,
  code,
  action,
}: {
  campaignId: string;
  code: string;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="CAMPAIGN"
      title={`Detach ${code}`}
      description="Future joins through this invite stop crediting the campaign. Past referrals keep their credit."
      confirmLabel="Detach invite"
      action={action}
      hidden={{ campaignId, code }}
      trigger={
        <Button size="sm" variant="ghost" iconLeft={Unlink} data-testid={`detach-${code}`}>
          Detach
        </Button>
      }
    />
  );
}

function pickerLabel(invite: invites.InviteCodeView): string {
  const owner = invite.vanity
    ? 'vanity URL'
    : (invite.inviterName ?? 'unknown inviter').slice(0, PICKER_NAME_MAX);
  const elsewhere = invite.campaignId ? ' · in another campaign' : '';
  return `${invite.code} — ${owner} · ${invite.uses} uses${elsewhere}`;
}

export function AttachInviteForm({
  campaignId,
  attachable,
  action,
}: {
  campaignId: string;
  attachable: readonly invites.InviteCodeView[];
  action: FormAction;
}) {
  if (attachable.length === 0) {
    return (
      <p className="text-small text-fg-subtle">
        Every mirrored invite is already attached here. Create an invite in Discord; the bot mirrors
        it within seconds.
      </p>
    );
  }
  return (
    <ActionForm action={action} resetOnSuccess aria-label="Attach an invite" className="space-y-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <FormField name="code" label="Attach an invite">
          <NativeSelect
            name="code"
            required
            placeholder="Choose an invite"
            options={attachable.map((invite) => ({
              value: invite.code,
              label: pickerLabel(invite),
            }))}
          />
        </FormField>
        <Button type="submit" variant="secondary" iconLeft={Link2}>
          Attach
        </Button>
      </div>
      <p className="text-small text-fg-subtle">
        Only future joins through the invite credit this campaign. History is never rewritten.
      </p>
    </ActionForm>
  );
}

export function DeleteCampaignButton({
  campaign,
  action,
}: {
  campaign: Pick<invites.CampaignView, 'id' | 'key'>;
  action: FormAction;
}) {
  return (
    <ConfirmActionDialog
      eyebrow="CAMPAIGN"
      title="Delete campaign"
      description={`Deletes ${campaign.key} permanently. Only a campaign that never credited anything can be deleted; otherwise deactivate it to keep its history.`}
      confirmLabel="Delete campaign"
      tone="danger"
      action={action}
      hidden={{ campaignId: campaign.id }}
      trigger={
        <Button variant="danger" iconLeft={Trash2} data-testid="delete-campaign">
          Delete campaign
        </Button>
      }
    />
  );
}
