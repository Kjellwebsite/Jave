import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { formatRate, Icon, Panel } from '@jave/ui';
import type { analytics } from '@jave/core';
import { retentionHint } from '@/lib/analytics-kpis';
import { formatHours, plural, signed } from '@/lib/analytics-view';
import { ReadoutGrid } from './readouts';

/** Compact organizational-health readout for /overview (analytics staff only). */
export function HealthStrip({ overview }: { overview: analytics.ServerOverview }) {
  const { members, applications, tickets } = overview;
  const range = overview.rangeDays;
  return (
    <Panel
      title={`Health · last ${range} days`}
      description="Arrivals that stay, decisions made on time, tickets answered."
      actions={
        <Link
          href={`/analytics?range=${range}`}
          className="inline-flex items-center gap-1 text-small text-fg-subtle hover:text-fg"
        >
          Analytics
          <Icon icon={ArrowUpRight} size="sm" />
        </Link>
      }
    >
      <ReadoutGrid
        columns={4}
        items={[
          {
            label: 'Net members',
            value: signed(members.net),
            hint: `${plural(members.joins, 'join')} · ${plural(members.leaves, 'leave')}`,
          },
          {
            label: 'D30 retention',
            value: formatRate(members.retention.d30.rate),
            hint: retentionHint(members.retention.d30),
          },
          {
            label: 'Median decision',
            value: formatHours(applications.medianHoursToDecision),
            hint: `${applications.pending.toLocaleString('en-US')} pending`,
          },
          {
            label: 'SLA breach rate',
            value: formatRate(tickets.slaBreachRate),
            hint: `${plural(tickets.open, 'ticket')} open`,
          },
        ]}
      />
    </Panel>
  );
}
