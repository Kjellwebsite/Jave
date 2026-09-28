import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  Mono,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import type { invites } from '@jave/core';
import { campaignDayValue } from '@/lib/campaign-form';
import { CAMPAIGN_STATE_LABELS, CAMPAIGN_STATE_TONE, campaignState } from '@/lib/referral-labels';

const COLUMNS = 5;

/** "2026-09-01 → 2026-09-30" in UTC days (end inclusive); open ends read "open". */
export function campaignWindow(campaign: { startsAt: Date | null; endsAt: Date | null }): string {
  const start = campaignDayValue(campaign.startsAt, 'startsAt') || 'open';
  const end = campaignDayValue(campaign.endsAt, 'endsAt') || 'open';
  return `${start} → ${end}`;
}

export function CampaignStateBadge({
  campaign,
  now,
}: {
  campaign: invites.CampaignView;
  now: Date;
}) {
  const state = campaignState(campaign, now);
  return (
    <StatusBadge
      tone={CAMPAIGN_STATE_TONE[state]}
      label={CAMPAIGN_STATE_LABELS[state]}
      quiet={state === 'accepting'}
    />
  );
}

/** Every campaign with its state, window and funnel; rows open the campaign. */
export function CampaignsTable({
  campaigns,
  now,
  emptyAction,
}: {
  campaigns: readonly invites.CampaignView[];
  now: Date;
  emptyAction?: ReactNode;
}) {
  return (
    <Table caption="Campaigns">
      <TableHead>
        <tr>
          <TableHeaderCell>Campaign</TableHeaderCell>
          <TableHeaderCell className="hidden sm:table-cell">State</TableHeaderCell>
          <TableHeaderCell className="hidden lg:table-cell">Window (UTC)</TableHeaderCell>
          <TableHeaderCell className="text-right">Joined</TableHeaderCell>
          <TableHeaderCell className="text-right">Valid</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {campaigns.length === 0 ? (
          <TableEmptyRow
            colSpan={COLUMNS}
            title="NO CAMPAIGNS"
            description="A campaign credits joins through its invites and codes while it is active and inside its window."
            action={emptyAction}
          />
        ) : (
          campaigns.map((campaign) => (
            <TableRow key={campaign.id}>
              <TableCell>
                <Link
                  href={`/referrals/campaigns/${campaign.id}`}
                  className="row-link block min-w-0"
                >
                  <span className="block truncate text-body font-medium text-fg">
                    {campaign.name}
                  </span>
                  <span className="type-data block truncate text-[12px] text-fg-subtle">
                    {campaign.key}
                  </span>
                </Link>
                <span className="mt-1.5 block sm:hidden">
                  <CampaignStateBadge campaign={campaign} now={now} />
                </span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <CampaignStateBadge campaign={campaign} now={now} />
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <Mono dim>{campaignWindow(campaign)}</Mono>
              </TableCell>
              <TableCell className="text-right">
                <Mono className={campaign.funnel.joined > 0 ? 'text-fg' : undefined}>
                  {campaign.funnel.joined}
                </Mono>
              </TableCell>
              <TableCell className="text-right">
                <Mono className={campaign.funnel.valid > 0 ? 'text-fg' : undefined}>
                  {campaign.funnel.valid}
                </Mono>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
