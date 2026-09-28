'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { invites, isUuid, NotFoundError, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { campaignDayValue, type CampaignDayField, parseCampaignDay } from '@/lib/campaign-form';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { CAMPAIGN_DELETED_NOTICE } from '@/lib/referral-labels';
import { runAction } from '@/server/actions';

/*
 * Referral and campaign mutations. Every identifier from the form is
 * untrusted: ids are shape-checked here, then core authorizes
 * (canManageCampaigns), validates, audits and refuses invalid transitions.
 */

const CAMPAIGN_FIELDS = ['key', 'name', 'description', 'startsAt', 'endsAt'] as const;
const REVIEW_DECISIONS = ['clear_flags', 'invalidate'] as const;

function campaignIdFrom(data: FormData): string {
  const id = formString(data, 'campaignId');
  if (!isUuid(id)) throw new NotFoundError('Campaign');
  return id;
}

function dayField(data: FormData, field: CampaignDayField): Date | null {
  const parsed = parseCampaignDay(formString(data, field), field);
  if (!parsed.ok) {
    throw new ValidationError('Dates use YYYY-MM-DD.', [{ path: field, message: 'Use a date.' }]);
  }
  return parsed.value;
}

function refresh(campaignId?: string): void {
  revalidatePath('/referrals');
  if (campaignId) revalidatePath(`/referrals/campaigns/${campaignId}`);
}

export async function createCampaignAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'campaign.create',
    async (ctx) => {
      const campaign = await invites.createCampaign(ctx, {
        key: formString(data, 'key'),
        name: formString(data, 'name'),
        description: formOptional(data, 'description'),
        startsAt: dayField(data, 'startsAt') ?? undefined,
        endsAt: dayField(data, 'endsAt') ?? undefined,
      });
      refresh(campaign.id);
      return `CAMPAIGN CREATED — ${campaign.key}.`;
    },
    { fieldNames: CAMPAIGN_FIELDS },
  );
}

/**
 * Edit name, description and window. A date left as displayed keeps the
 * stored instant exactly, so saving an untouched form never shifts a
 * boundary that was not set on a UTC midnight.
 */
export async function updateCampaignAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'campaign.update',
    async (ctx) => {
      const current = await invites.getCampaign(ctx, campaignIdFrom(data));
      const windowChange = (field: CampaignDayField) => {
        const submitted = formString(data, field).trim();
        if (submitted === campaignDayValue(current[field], field)) return undefined;
        return dayField(data, field);
      };
      const updated = await invites.updateCampaign(ctx, {
        campaignId: current.id,
        name: formString(data, 'name'),
        description: formOptional(data, 'description') ?? null,
        startsAt: windowChange('startsAt'),
        endsAt: windowChange('endsAt'),
      });
      refresh(current.id);
      return `CAMPAIGN SAVED — ${updated.key}.`;
    },
    { fieldNames: CAMPAIGN_FIELDS },
  );
}

export async function setCampaignActiveAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction('campaign.set_active', async (ctx) => {
    const active = formEnum(data, 'active', ['true', 'false'] as const);
    if (!active) throw new ValidationError('Choose a state.');
    const campaign = await invites.updateCampaign(ctx, {
      campaignId: campaignIdFrom(data),
      active: active === 'true',
    });
    refresh(campaign.id);
    return campaign.active
      ? `CAMPAIGN ACTIVATED — ${campaign.key}.`
      : `CAMPAIGN DEACTIVATED — ${campaign.key}. New joins no longer credit it.`;
  });
}

export async function deleteCampaignAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('campaign.delete', async (ctx) => {
    await invites.deleteCampaign(ctx, campaignIdFrom(data));
    revalidatePath('/referrals');
    redirect(`/referrals?tab=campaigns&notice=${CAMPAIGN_DELETED_NOTICE}`);
  });
}

export async function attachInviteAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'campaign.attach_invite',
    async (ctx) => {
      const campaignId = campaignIdFrom(data);
      const code = formString(data, 'code').trim();
      if (!code) {
        throw new ValidationError('Choose an invite.', [{ path: 'code', message: 'Choose one.' }]);
      }
      const invite = await invites.attachInviteToCampaign(ctx, { code, campaignId });
      refresh(campaignId);
      return `INVITE ATTACHED — ${invite.code}. Future joins through it credit this campaign.`;
    },
    { fieldNames: ['code'] },
  );
}

export async function detachInviteAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('campaign.detach_invite', async (ctx) => {
    const campaignId = campaignIdFrom(data);
    // Core detaches only while the invite is attached to this campaign (a stale page is NOT FOUND).
    const invite = await invites.detachInviteFromCampaign(ctx, {
      code: formString(data, 'code'),
      campaignId,
    });
    refresh(campaignId);
    return `INVITE DETACHED — ${invite.code}. Past referrals keep their credit.`;
  });
}

export async function reviewReferralAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'referral.review',
    async (ctx) => {
      const referralId = formString(data, 'referralId');
      if (!isUuid(referralId)) throw new NotFoundError('Referral');
      const decision = formEnum(data, 'decision', REVIEW_DECISIONS);
      if (!decision) throw new ValidationError('Choose a decision.');
      await invites.reviewReferral(ctx, { referralId, decision, note: formString(data, 'note') });
      refresh();
      return decision === 'clear_flags'
        ? 'FLAGS CLEARED — the referral can become VALID.'
        : 'REFERRAL INVALIDATED — removed from every count.';
    },
    { fieldNames: ['note'] },
  );
}
