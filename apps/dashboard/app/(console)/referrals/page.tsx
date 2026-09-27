import type { Metadata } from 'next';
import Link from 'next/link';
import { can, isUuid } from '@jave/core';
import {
  Button,
  buttonStyles,
  Callout,
  Card,
  LinkTabs,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { NewCampaignDialog } from '@/components/referrals/campaign-fields';
import { CampaignsTable } from '@/components/referrals/campaigns-table';
import { FunnelPanel } from '@/components/referrals/funnel-panel';
import { InvitersTable } from '@/components/referrals/inviters-table';
import { InvitesTable } from '@/components/referrals/invites-table';
import { ReviewQueue } from '@/components/referrals/review-queue';
import { RestrictedPage } from '@/components/restricted-page';
import { CAMPAIGN_DELETED_NOTICE, parseReferralTab, type ReferralTab } from '@/lib/referral-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { loadReferralsPage, type ReferralsPageData } from '@/server/data/referrals';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { createCampaignAction, reviewReferralAction } from './actions';

export const metadata: Metadata = { title: 'Referrals' };

const TAB_LABELS: Record<ReferralTab, string> = {
  inviters: 'Inviters',
  campaigns: 'Campaigns',
  review: 'Review queue',
  invites: 'Invites',
};

function tabHref(tab: ReferralTab, extra: Record<string, string | number | undefined> = {}) {
  return `/referrals${toQueryString({ tab: tab === 'inviters' ? undefined : tab, ...extra })}`;
}

function PageFooter({
  page,
  href,
}: {
  page: { offset: number; limit: number; total: number };
  href: (offset: number) => string;
}) {
  if (page.total === 0) return null;
  return (
    <div className="border-t border-line-subtle px-5 py-3">
      <Pagination
        offset={page.offset}
        limit={page.limit}
        total={page.total}
        linkComponent={NextLink}
        hrefForOffset={href}
      />
    </div>
  );
}

function InviterFilter({
  campaigns,
  current,
}: {
  campaigns: ReferralsPageData['campaigns'];
  current: string | undefined;
}) {
  if (campaigns.length === 0) return null;
  return (
    <form
      method="get"
      action="/referrals"
      aria-label="Filter inviters"
      className="border-b border-line-subtle p-4"
    >
      <Toolbar className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 sm:flex">
        <NativeSelect
          name="campaign"
          aria-label="Campaign"
          defaultValue={current ?? ''}
          placeholder="Any campaign"
          options={campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
          className="sm:w-72"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {current ? (
            <Link href="/referrals" className={buttonStyles({ variant: 'ghost' })}>
              Reset
            </Link>
          ) : null}
        </div>
      </Toolbar>
    </form>
  );
}

export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const tab = parseReferralTab(firstParam(params.tab));
  const campaignParam = firstParam(params.campaign);
  const campaignId = campaignParam && isUuid(campaignParam) ? campaignParam : undefined;
  const offset = offsetParam(params.offset);

  const loaded = await guarded(() =>
    loadReferralsPage(ctx, {
      tab,
      offset,
      campaignId: tab === 'inviters' ? campaignId : undefined,
    }),
  );
  if (!loaded.ok) {
    return <RestrictedPage eyebrow="PEOPLE" title="Referrals" capability="canViewAnalytics" />;
  }
  const { funnel, campaigns, counts, data } = loaded.value;
  const viewer = await loadViewer(ctx);
  const manage = can(ctx, 'canManageCampaigns');
  const now = ctx.clock.now();
  const deleted = firstParam(params.notice) === CAMPAIGN_DELETED_NOTICE;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE"
        title="Referrals"
        description="Who brings in people who stay. Credit is earned at VALID — raw invite volume never counts."
        meta={<Mono dim>{counts.inviters.toLocaleString('en-US')} inviters</Mono>}
        actions={manage ? <NewCampaignDialog action={createCampaignAction} /> : null}
      />

      {deleted ? (
        <Callout tone="success" role="status">
          CAMPAIGN DELETED.
        </Callout>
      ) : null}

      <FunnelPanel
        funnel={funnel}
        title="Server-wide funnel"
        description="Every attributed join, all time. INVITED counts invite uses and code claims."
      />

      <div className="space-y-6">
        <LinkTabs
          label="Referral sections"
          linkComponent={NextLink}
          tabs={(Object.keys(TAB_LABELS) as ReferralTab[]).map((key) => ({
            href: tabHref(key),
            label: TAB_LABELS[key],
            active: key === tab,
            meta: (
              <Mono dim className="text-[11px]">
                {counts[key]}
              </Mono>
            ),
          }))}
        />

        {data.tab === 'inviters' ? (
          <Card padding="none">
            <InviterFilter campaigns={campaigns} current={campaignId} />
            <InvitersTable
              rows={data.page.items}
              linkToMembers={can(ctx, 'canViewMembers')}
              empty={
                campaignId
                  ? {
                      title: 'NO JOINS IN THIS CAMPAIGN',
                      description: 'No attributed join credits this campaign yet.',
                    }
                  : {
                      title: 'NO INVITERS YET',
                      description:
                        'Inviters appear once a join is attributed to their invite link or referral code.',
                    }
              }
            />
            <PageFooter
              page={data.page}
              href={(next) =>
                tabHref('inviters', { campaign: campaignId, offset: next || undefined })
              }
            />
          </Card>
        ) : null}

        {data.tab === 'campaigns' ? (
          <Card padding="none">
            <CampaignsTable campaigns={campaigns} now={now} />
          </Card>
        ) : null}

        {data.tab === 'review' ? (
          <Card padding="none">
            <ReviewQueue
              items={data.page.items}
              canReview={manage}
              reviewAction={reviewReferralAction}
              timeZone={viewer.timeZone}
            />
            <PageFooter
              page={data.page}
              href={(next) => tabHref('review', { offset: next || undefined })}
            />
          </Card>
        ) : null}

        {data.tab === 'invites' ? (
          <Card padding="none">
            <InvitesTable
              items={data.page.items}
              campaignNames={new Map(campaigns.map((campaign) => [campaign.id, campaign.name]))}
              timeZone={viewer.timeZone}
              empty={{
                title: 'NO INVITES MIRRORED',
                description:
                  'The bot mirrors Discord invites on start and whenever one is created or deleted. It needs Manage Server to read them.',
              }}
            />
            <PageFooter
              page={data.page}
              href={(next) => tabHref('invites', { offset: next || undefined })}
            />
          </Card>
        ) : null}
      </div>
    </div>
  );
}
