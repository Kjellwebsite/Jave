/**
 * Labels, tones and pure helpers for the referrals pages. Client-safe.
 * Core decides every rule; these only describe its states.
 */
import type { invites } from '@jave/core';
import type { BadgeTone } from '@jave/ui';
import { plural } from './analytics-view';
import { toQueryString } from './search-params';

export type ReferralStatusKey = 'joined' | 'retained' | 'valid' | 'left' | 'invalid';

export const REFERRAL_STATUS_LABELS: Record<ReferralStatusKey, string> = {
  joined: 'Joined',
  retained: 'Retained',
  valid: 'Valid',
  left: 'Left',
  invalid: 'Invalid',
};

export const REFERRAL_STATUS_TONE: Record<ReferralStatusKey, BadgeTone> = {
  joined: 'neutral',
  retained: 'info',
  valid: 'success',
  left: 'neutral',
  invalid: 'danger',
};

const METHOD_LABELS: Record<string, string> = {
  invite: 'Invite link',
  vanity: 'Vanity URL',
  referral_code: 'Referral code',
  unknown: 'Unknown source',
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

/** What each anomaly flag means, in one line (staff-facing). */
const ANOMALY_FLAG_COPY: Record<string, { label: string; detail: string }> = {
  self_invite: { label: 'Self-invite', detail: 'Inviter and invitee are the same person.' },
  new_account: { label: 'New account', detail: 'The account was very new at join time.' },
  join_burst: { label: 'Join burst', detail: '5+ of the inviter’s joins within one hour.' },
  new_account_share: {
    label: 'New-account share',
    detail: 'Half or more of the inviter’s referrals are very new accounts.',
  },
  fast_leave: { label: 'Fast leave', detail: 'Left within 24 hours of joining.' },
  fast_leave_share: {
    label: 'Fast-leave share',
    detail: '40% or more of the inviter’s referrals left within 24 hours.',
  },
  similar_usernames: {
    label: 'Similar usernames',
    detail: 'Other invitees of this inviter share a near-identical name.',
  },
  rejoin: { label: 'Rejoin', detail: 'This person had joined before.' },
};

export function anomalyFlagLabel(flag: string): string {
  return ANOMALY_FLAG_COPY[flag]?.label ?? flag;
}

export function anomalyFlagDetail(flag: string): string {
  return ANOMALY_FLAG_COPY[flag]?.detail ?? 'Unrecognized signal.';
}

export type CampaignState = 'accepting' | 'scheduled' | 'ended' | 'inactive';

export const CAMPAIGN_STATE_LABELS: Record<CampaignState, string> = {
  accepting: 'ACCEPTING',
  scheduled: 'SCHEDULED',
  ended: 'ENDED',
  inactive: 'INACTIVE',
};

export const CAMPAIGN_STATE_TONE: Record<CampaignState, BadgeTone> = {
  accepting: 'success',
  scheduled: 'info',
  ended: 'neutral',
  inactive: 'neutral',
};

/** Describes core's `acceptingNow` verdict: why a campaign is or is not crediting joins. */
export function campaignState(
  campaign: { active: boolean; acceptingNow: boolean; startsAt: Date | null },
  now: Date,
): CampaignState {
  if (!campaign.active) return 'inactive';
  if (campaign.acceptingNow) return 'accepting';
  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) return 'scheduled';
  return 'ended';
}

export const REFERRAL_TABS = ['inviters', 'campaigns', 'review', 'invites'] as const;
export type ReferralTab = (typeof REFERRAL_TABS)[number];

export function parseReferralTab(raw: string | undefined): ReferralTab {
  return (REFERRAL_TABS as readonly string[]).includes(raw ?? '')
    ? (raw as ReferralTab)
    : 'inviters';
}

/** `?notice=` value set after a campaign is deleted (the page shows fixed copy for it). */
export const CAMPAIGN_DELETED_NOTICE = 'campaign-deleted';

/** Why a campaign can or cannot be deleted, from core's usage counts (its delete predicate). */
export function campaignDeletionNote(usage: invites.CampaignUsage): string {
  if (usage.deletable) {
    return 'Nothing references it, so it can be removed without losing history.';
  }
  if (usage.referrals > 0) {
    return 'Joins were credited to it. Deactivate it instead: its history stays intact.';
  }
  if (usage.referralCodes > 0) {
    return 'Referral codes were issued for it. Deactivate it instead: its history stays intact.';
  }
  const deleted = usage.deletedInvites > 0 ? `, ${usage.deletedInvites} deleted on Discord` : '';
  return `It still has ${plural(usage.attachedInvites, 'attached invite')}${deleted}. Detach them to delete it, or deactivate it instead.`;
}

/** The three independent page offsets of a campaign page. */
export interface CampaignPageOffsets {
  /** Per-inviter funnels. */
  offset: number;
  /** Attached invites. */
  attached: number;
  /** Attach picker. */
  picker: number;
}

/** A campaign page URL; zero offsets are left out. */
export function campaignHref(campaignId: string, offsets: CampaignPageOffsets): string {
  return `/referrals/campaigns/${campaignId}${toQueryString({
    offset: offsets.offset || null,
    attached: offsets.attached || null,
    picker: offsets.picker || null,
  })}`;
}

/** Why the attach picker offers nothing: no mirrored invites, or all already attached. */
export function attachPickerEmptyNote(picker: { total: number; paged: boolean }): string {
  if (picker.total === 0) {
    return 'No live invites are mirrored yet. Create an invite in Discord; the bot mirrors it within seconds.';
  }
  if (picker.paged) {
    return 'Every invite on this page is already attached here. Page through the rest below.';
  }
  return 'Every mirrored invite is already attached here. Create an invite in Discord; the bot mirrors it within seconds.';
}
