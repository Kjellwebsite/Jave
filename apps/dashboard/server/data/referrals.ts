import 'server-only';
import { invites, type Page, type ServiceContext } from '@jave/core';
import type { ReferralTab } from '@/lib/referral-labels';

/** Rows per page on every referrals table. */
export const REFERRALS_PAGE_SIZE = 25;

export interface ReferralTabCounts {
  inviters: number;
  campaigns: number;
  review: number;
  invites: number;
}

export type ReferralTabData =
  | { tab: 'inviters'; page: Page<invites.InviterFunnelRow> }
  /** The campaigns tab renders `ReferralsPageData.campaigns`. */
  | { tab: 'campaigns' }
  | { tab: 'review'; page: Page<invites.ReferralListItem> }
  | { tab: 'invites'; page: Page<invites.InviteCodeView> };

export interface ReferralsPageData {
  funnel: invites.ReferralFunnel;
  /** Every campaign (the inviters filter and the campaigns tab use it). */
  campaigns: invites.CampaignView[];
  counts: ReferralTabCounts;
  data: ReferralTabData;
}

export interface ReferralsQuery {
  tab: ReferralTab;
  offset: number;
  /** Inviters tab: restrict funnels to one campaign. */
  campaignId?: string;
}

/**
 * The staff referrals page. The server-wide funnel is read first: core
 * authorizes it (canViewAnalytics), so a refused viewer produces one audited
 * denial and nothing else runs. Tab counts are one small aggregate each.
 */
export async function loadReferralsPage(
  ctx: ServiceContext,
  query: ReferralsQuery,
): Promise<ReferralsPageData> {
  const funnel = await invites.getReferralFunnel(ctx, {});
  const page = { limit: REFERRALS_PAGE_SIZE, offset: query.offset };
  const [campaigns, inviterCount, flagged, mirrored, data] = await Promise.all([
    invites.listCampaigns(ctx, { includeInactive: true }),
    invites.listInviterFunnels(ctx, { limit: 1 }),
    invites.listReferrals(ctx, { reviewable: true, limit: 1 }),
    invites.listInviteCodes(ctx, { limit: 1 }),
    loadTab(ctx, query, page),
  ]);
  return {
    funnel,
    campaigns,
    counts: {
      inviters: inviterCount.total,
      campaigns: campaigns.length,
      review: flagged.total,
      invites: mirrored.total,
    },
    data,
  };
}

async function loadTab(
  ctx: ServiceContext,
  query: ReferralsQuery,
  page: { limit: number; offset: number },
): Promise<ReferralTabData> {
  switch (query.tab) {
    case 'inviters':
      return {
        tab: 'inviters',
        page: await invites.listInviterFunnels(ctx, { ...page, campaignId: query.campaignId }),
      };
    case 'campaigns':
      return { tab: 'campaigns' };
    case 'review':
      return {
        tab: 'review',
        page: await invites.listReferrals(ctx, { ...page, reviewable: true }),
      };
    case 'invites':
      return { tab: 'invites', page: await invites.listInviteCodes(ctx, page) };
  }
}

export interface CampaignPageData {
  campaign: invites.CampaignView;
  /** What references the campaign; `deletable` is core's delete predicate. */
  usage: invites.CampaignUsage;
  /** Attached invites, live first, then ones Discord has deleted (still detachable). */
  attached: Page<invites.InviteCodeView>;
  /** One page of live invites for the attach picker, most used first. */
  picker: Page<invites.InviteCodeView>;
  /** The picker page without invites already attached here. */
  attachable: invites.InviteCodeView[];
  inviters: Page<invites.InviterFunnelRow>;
}

export interface CampaignPageQuery {
  /** Offset into the per-inviter funnels. */
  offset: number;
  /** Offset into the attached invites. */
  attachedOffset: number;
  /** Offset into the attach picker's live invites. */
  pickerOffset: number;
}

/** Live invites per attach-picker page (core's page cap). */
export const ATTACH_PICKER_PAGE_SIZE = 100;

/** Load `offset`; past the end of a non-empty list (a stale link), load the last page instead. */
async function pageWithin<T>(
  load: (offset: number) => Promise<Page<T>>,
  offset: number,
  pageSize: number,
): Promise<Page<T>> {
  const page = await load(offset);
  if (page.items.length > 0 || page.total === 0) return page;
  return load(Math.floor((page.total - 1) / pageSize) * pageSize);
}

/**
 * One campaign with its attached invites, the attach picker and per-inviter
 * funnels (canViewAnalytics). The campaign is read first: core authorizes it,
 * so a refused viewer produces one audited denial and nothing else runs.
 */
export async function loadCampaignPage(
  ctx: ServiceContext,
  campaignId: string,
  query: CampaignPageQuery,
): Promise<CampaignPageData> {
  const campaign = await invites.getCampaign(ctx, campaignId);
  const [usage, attached, picker, inviters] = await Promise.all([
    invites.getCampaignUsage(ctx, campaignId),
    pageWithin(
      (offset) =>
        invites.listInviteCodes(ctx, {
          campaignId,
          includeDeleted: true,
          limit: REFERRALS_PAGE_SIZE,
          offset,
        }),
      query.attachedOffset,
      REFERRALS_PAGE_SIZE,
    ),
    pageWithin(
      (offset) => invites.listInviteCodes(ctx, { limit: ATTACH_PICKER_PAGE_SIZE, offset }),
      query.pickerOffset,
      ATTACH_PICKER_PAGE_SIZE,
    ),
    invites.listInviterFunnels(ctx, {
      campaignId,
      limit: REFERRALS_PAGE_SIZE,
      offset: query.offset,
    }),
  ]);
  return {
    campaign,
    usage,
    attached,
    picker,
    attachable: picker.items.filter((invite) => invite.campaignId !== campaignId),
    inviters,
  };
}
