import {
  BarList,
  ChartLegend,
  cx,
  formatCount,
  HeatCell,
  Panel,
  RoleBadge,
  StackedBar,
  Stat,
  Table,
  TableHead,
  TableHeaderCell,
} from '@jave/ui';
import type { analytics } from '@jave/core';
import type { AnalyticsView } from '@/server/data/analytics';
import { AnalyticsSection } from './readouts';

/** The progression ladder, highest first. */
const LADDER: readonly analytics.ProgressionRole[] = ['verified', 'trial', 'applicant', 'member'];

function share(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '';
}

function CapabilityRows({ distribution }: { distribution: readonly analytics.JavelinProgress['capabilityDistribution'][number][] }) {
  return (
    <ul className="space-y-3.5">
      {distribution.map((domain) => {
        const total = domain.verified + domain.claimedOnly + domain.unknown;
        return (
          <li
            key={domain.domainKey}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[5.5rem_minmax(0,1fr)_9.5rem]"
          >
            <span className="type-eyebrow text-fg-muted">{domain.label}</span>
            <StackedBar
              label={`${domain.label}: ${domain.verified} verified, ${domain.claimedOnly} claimed only, ${domain.unknown} unknown`}
              segments={[
                { key: 'verified', label: 'Verified', value: domain.verified, step: 1 },
                { key: 'claimed', label: 'Claimed only', value: domain.claimedOnly, step: 2 },
                { key: 'unknown', label: 'Unknown', value: domain.unknown, step: 3 },
              ]}
            />
            <span className="type-data col-start-2 text-[12px] text-fg-subtle sm:col-start-auto sm:text-right">
              <span className="text-fg">{formatCount(domain.verified)}</span> ·{' '}
              {formatCount(domain.claimedOnly)} · {formatCount(domain.unknown)}
              <span className="sr-only"> of {total}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TierTable({ distribution }: { distribution: readonly analytics.JavelinProgress['capabilityDistribution'][number][] }) {
  const tiers = [...(distribution[0]?.tiers ?? [])].reverse();
  const max = distribution.reduce(
    (peak, domain) => domain.tiers.reduce((m, tier) => Math.max(m, tier.count), peak),
    0,
  );
  return (
    <Table caption="Members by peak verified tier per domain" className="text-small">
      <TableHead>
        <tr>
          <TableHeaderCell>Domain</TableHeaderCell>
          {tiers.map((tier) => (
            <TableHeaderCell key={tier.code} className="text-center">
              {tier.code}
            </TableHeaderCell>
          ))}
        </tr>
      </TableHead>
      <tbody>
        {distribution.map((domain) => {
          const counts = new Map(domain.tiers.map((tier) => [tier.code, tier.count]));
          return (
            <tr key={domain.domainKey}>
              <th
                scope="row"
                className="type-eyebrow whitespace-nowrap py-0 pr-4 pl-5 text-left font-medium text-fg-muted"
              >
                {domain.label}
              </th>
              {tiers.map((tier) => (
                <HeatCell key={tier.code} value={counts.get(tier.code) ?? 0} max={max} />
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function ProgressSection({ view }: { view: AnalyticsView }) {
  const progress = view.progress;
  const onLadder = LADDER.reduce((sum, role) => sum + progress.progression[role], 0);
  const outcomes = [
    { label: 'TRIALS PASSED', value: progress.trialsPassed, hint: 'Published pass or distinction' },
    { label: 'PROJECTS SHIPPED', value: progress.projectsShipped, hint: 'Marked shipped' },
    {
      label: 'VERIFIED CONTRIBUTIONS',
      value: progress.verifiedContributions,
      hint: 'Reviewed and accepted',
    },
    { label: 'MISSIONS COMPLETED', value: progress.missionsCompleted, hint: 'Verified assignments' },
  ];
  return (
    <AnalyticsSection
      id="progress"
      title="JAVELIN progress"
      description="What the organization has proven, all time. Capability stays per domain: there is no total across domains."
    >
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {outcomes.map((outcome) => (
          <Stat key={outcome.label} label={outcome.label} value={outcome.value} hint={outcome.hint} />
        ))}
      </dl>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <Panel title="Progression" description={`${formatCount(progress.presentMembers)} present members.`}>
          <BarList
            label="Present members by progression role"
            items={LADDER.map((role) => ({
              key: role,
              label: <RoleBadge role={role} size="sm" />,
              value: progress.progression[role],
              hint: share(progress.progression[role], onLadder),
            }))}
          />
          <p className="mt-4 text-small text-fg-subtle">
            Progression roles are mutually exclusive: each member holds at most one.
          </p>
        </Panel>
        <Panel
          title="Verified capability"
          description="Per domain, each present member counted once: peak VERIFIED rank, else CLAIMED, else UNKNOWN. Unknown is not low."
        >
          <div className="space-y-6">
            <ChartLegend
              items={[
                { key: 'verified', label: 'Verified', step: 1 },
                { key: 'claimed', label: 'Claimed only', step: 2 },
                { key: 'unknown', label: 'Unknown', step: 3 },
              ]}
            />
            <CapabilityRows distribution={progress.capabilityDistribution} />
            <div className={cx('-mx-5 border-t border-line-subtle pt-4')}>
              <p className="type-eyebrow px-5 pb-2 text-fg-subtle">Verified members by peak tier</p>
              <TierTable distribution={progress.capabilityDistribution} />
            </div>
          </div>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
