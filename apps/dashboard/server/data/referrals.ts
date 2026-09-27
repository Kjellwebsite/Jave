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
  attached: invites.InviteCodeView[];
  attachedTotal: number;
  /** Live invites not yet in this campaign (the attach picker). */
  attachable: invites.InviteCodeView[];
  inviters: Page<invites.InviterFunnelRow>;
}

/** Invites offered by the attach picker (most used first). */
const ATTACHABLE_LIMIT = 100;

/** One campaign with its attached invites and per-inviter funnels (canViewAnalytics). */
export async function loadCampaignPage(
  ctx: ServiceContext,
  campaignId: string,
  offset: number,
): Promise<CampaignPageData> {
  const campaign = await invites.getCampaign(ctx, campaignId);
  const [attached, live, inviters] = await Promise.all([
    invites.listInviteCodes(ctx, { campaignId, limit: ATTACHABLE_LIMIT }),
    invites.listInviteCodes(ctx, { limit: ATTACHABLE_LIMIT }),
    invites.listInviterFunnels(ctx, { campaignId, limit: REFERRALS_PAGE_SIZE, offset }),
  ]);
  return {
    campaign,
    attached: attached.items,
    attachedTotal: attached.total,
    attachable: live.items.filter((invite) => invite.campaignId !== campaignId),
    inviters,
  };
}
