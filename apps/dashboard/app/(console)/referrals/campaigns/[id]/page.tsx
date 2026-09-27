import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, isUuid } from '@jave/core';
import { Card, Icon, Mono, Pagination, Panel } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import {
  AttachInviteForm,
  CampaignActiveToggle,
  CampaignEditForm,
  DeleteCampaignButton,
  DetachInviteButton,
} from '@/components/referrals/campaign-controls';
import { CampaignStateBadge, campaignWindow } from '@/components/referrals/campaigns-table';
import { FunnelPanel } from '@/components/referrals/funnel-panel';
import { InvitersTable } from '@/components/referrals/inviters-table';
import { InvitesTable } from '@/components/referrals/invites-table';
import { RestrictedPage } from '@/components/restricted-page';
import { plural } from '@/lib/analytics-view';
import { campaignDayValue } from '@/lib/campaign-form';
import { offsetParam, type SearchParams } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadCampaignPage } from '@/server/data/referrals';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import {
  attachInviteAction,
  deleteCampaignAction,
  detachInviteAction,
  setCampaignActiveAction,
  updateCampaignAction,
} from '../../actions';

export const metadata: Metadata = { title: 'Campaign' };

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const offset = offsetParam((await searchParams).offset);
  const loaded = await guarded(() => loadCampaignPage(ctx, id, offset));
  if (!loaded.ok) {
    return (
      <RestrictedPage eyebrow="PEOPLE / REFERRALS" title="Campaign" capability="canViewAnalytics" />
    );
  }
  const { campaign, attached, attachedTotal, attachable, inviters } = loaded.value;
  const viewer = await loadViewer(ctx);
  const manage = can(ctx, 'canManageCampaigns');
  const now = ctx.clock.now();
  // Core refuses to delete anything that credited activity; hide a button that would always fail.
  const deletable =
    attachedTotal === 0 && campaign.funnel.joined === 0 && campaign.funnel.codeClaims === 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-6 border-b border-line-subtle pb-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2.5">
          <Link
            href="/referrals?tab=campaigns"
            className="type-eyebrow inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg"
          >
            <Icon icon={ArrowLeft} size="sm" />
            PEOPLE / REFERRALS / CAMPAIGNS
          </Link>
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
            {campaign.name}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <Mono>{campaign.key}</Mono>
            <CampaignStateBadge campaign={campaign} now={now} />
            <Mono dim>{campaignWindow(campaign)} UTC</Mono>
          </div>
          {campaign.description ? (
            <p className="max-w-2xl whitespace-pre-wrap text-body text-fg-muted">
              {campaign.description}
            </p>
          ) : null}
        </div>
        {manage ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <CampaignActiveToggle campaign={campaign} action={setCampaignActiveAction} />
          </div>
        ) : null}
      </header>

      <FunnelPanel
        funnel={campaign.funnel}
        title="Campaign funnel"
        description="Joins credited to this campaign. INVITED counts all uses of its invites, including uses before they were attached."
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          title="Attached invites"
          description={`${plural(attachedTotal, 'invite')} ${attachedTotal === 1 ? 'credits' : 'credit'} this campaign.`}
          flush
        >
          <InvitesTable
            items={attached}
            caption="Attached invites"
            timeZone={viewer.timeZone}
            empty={{
              title: 'NO INVITES ATTACHED',
              description: 'Attach a Discord invite so joins through it credit this campaign.',
            }}
            actions={
              manage
                ? (invite) => (
                    <DetachInviteButton
                      campaignId={campaign.id}
                      code={invite.code}
                      action={detachInviteAction}
                    />
                  )
                : undefined
            }
          />
          {manage ? (
            <div className="border-t border-line-subtle p-5">
              <AttachInviteForm
                campaignId={campaign.id}
                attachable={attachable}
                action={attachInviteAction}
              />
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Settings"
          description={
            manage ? 'Changes are audited with a field-level diff.' : 'Read-only for your roles.'
          }
        >
          {manage ? (
            <CampaignEditForm
              campaignId={campaign.id}
              action={updateCampaignAction}
              defaults={{
                name: campaign.name,
                description: campaign.description ?? '',
                startsAt: campaignDayValue(campaign.startsAt, 'startsAt'),
                endsAt: campaignDayValue(campaign.endsAt, 'endsAt'),
              }}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <dt className="type-eyebrow text-fg-subtle">CREATED</dt>
                <dd className="mt-1.5">
                  <Mono>{formatDate(campaign.createdAt, viewer.timeZone)}</Mono>
                </dd>
              </div>
              <div>
                <dt className="type-eyebrow text-fg-subtle">UPDATED</dt>
                <dd className="mt-1.5">
                  <Mono>{formatDate(campaign.updatedAt, viewer.timeZone)}</Mono>
                </dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>

      <Panel
        title="Inviters in this campaign"
        description="Per-inviter funnels restricted to joins credited to this campaign."
        flush
      >
        <InvitersTable
          rows={inviters.items}
          caption="Inviters in this campaign"
          linkToMembers={can(ctx, 'canViewMembers')}
          empty={{
            title: 'NO INVITERS YET',
            description: 'Inviters appear once a join credits this campaign.',
          }}
        />
        {inviters.total > 0 ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <Pagination
              offset={inviters.offset}
              limit={inviters.limit}
              total={inviters.total}
              linkComponent={NextLink}
              hrefForOffset={(next) =>
                `/referrals/campaigns/${campaign.id}${next ? `?offset=${next}` : ''}`
              }
            />
          </div>
        ) : null}
      </Panel>

      {manage ? (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="type-heading text-fg">Delete campaign</h2>
            <p className="text-small text-fg-subtle">
              {deletable
                ? 'Nothing was ever credited to it, so it can be removed without losing history.'
                : 'It has attached invites or credited joins. Deactivate it instead: its history stays intact.'}
            </p>
          </div>
          {deletable ? (
            <DeleteCampaignButton campaign={campaign} action={deleteCampaignAction} />
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
