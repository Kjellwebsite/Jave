import type { ReactNode } from 'react';
import { formatRate, FunnelChart, Panel } from '@jave/ui';
import type { invites } from '@jave/core';
import { plural } from '@/lib/analytics-view';
import { ReadoutGrid } from '../analytics/readouts';

/** The referral stages in order; VALID is the only one that counts. */
export function funnelStages(funnel: invites.ReferralFunnel) {
  return [
    {
      key: 'invited',
      label: 'INVITED',
      value: funnel.invited,
      note: `${plural(funnel.inviteUses, 'invite use')} · ${plural(funnel.codeClaims, 'code claim')}`,
    },
    { key: 'joined', label: 'JOINED', value: funnel.joined, note: 'Attributed joins' },
    {
      key: 'retained',
      label: 'RETAINED',
      value: funnel.retained,
      note: `${formatRate(funnel.retentionRate)} of joined stayed past the retention period`,
    },
    {
      key: 'valid',
      label: 'VALID',
      value: funnel.valid,
      note: `${formatRate(funnel.validRate)} of joined · the only stage that counts`,
    },
  ];
}

/** INVITED → JOINED → RETAINED → VALID with the exits beside it. */
export function FunnelPanel({
  funnel,
  title,
  description,
  actions,
}: {
  funnel: invites.ReferralFunnel;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Panel title={title} description={description} actions={actions}>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <FunnelChart label={title} stages={funnelStages(funnel)} emphasis="valid" />
        <ReadoutGrid
          columns={2}
          items={[
            { label: 'Left', value: funnel.left, hint: 'Left before VALID' },
            { label: 'Invalid', value: funnel.invalid, hint: 'Self-invites, staff' },
            { label: 'Under review', value: funnel.flagged, hint: 'Carrying anomaly flags' },
            { label: 'Fast leaves', value: funnel.fastLeaves, hint: 'Left within 24 hours' },
          ]}
        />
      </div>
    </Panel>
  );
}
