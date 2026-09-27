import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import {
  ChartFrame,
  ChartLegend,
  ColumnChart,
  formatCount,
  Icon,
  LineChart,
  Meter,
  Panel,
} from '@jave/ui';
import type { analytics } from '@jave/core';
import { flowPoints, latestValue, seriesTotal, signed, toChartPoints } from '@/lib/analytics-view';
import { formatDate } from '@/lib/time';
import type { AnalyticsView } from '@/server/data/analytics';
import { AnalyticsSection, ReadoutGrid } from './readouts';

function cohortCaption(cohort: analytics.RetentionCohort, timeZone: string): string {
  const window = `${formatDate(cohort.window.start, timeZone)} → ${formatDate(cohort.window.end, timeZone)}`;
  if (cohort.cohort === 0) return `No joins in the cohort window ${window}.`;
  return `${formatCount(cohort.retained)} of ${formatCount(cohort.cohort)} joins stayed ${cohort.horizonDays} days · joined ${window}`;
}

export function MembersSection({ view, timeZone }: { view: AnalyticsView; timeZone: string }) {
  const { overview, series, range } = view;
  const members = overview.members;
  const flow = flowPoints(series['members.joins'].points, series['members.leaves'].points);
  const joinsTotal = seriesTotal(series['members.joins'].points);
  const leavesTotal = seriesTotal(series['members.leaves'].points);
  const present = series['members.present'];
  return (
    <AnalyticsSection
      id="members"
      title="Members"
      description="Who arrives, who stays. Joins and leaves come from the guild event stream; retention follows each join."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          level={3}
          title="Joins and leaves"
          description={`Daily snapshots, last ${range} days (UTC).`}
        >
          <ChartFrame
            title="Daily flow"
            description="Joins above the baseline, leaves below. Shaded days have no snapshot."
            value={joinsTotal === null ? '—' : signed(joinsTotal - (leavesTotal ?? 0))}
            legend={
              <ChartLegend
                items={[
                  { key: 'joins', label: 'Joins', tone: 'primary', value: formatCount(joinsTotal) },
                  {
                    key: 'leaves',
                    label: 'Leaves',
                    tone: 'secondary',
                    value: formatCount(leavesTotal),
                  },
                ]}
              />
            }
            table={{
              caption: 'Daily joins and leaves',
              columns: ['Day', 'Joins', 'Leaves', 'Net'],
              rows: flow.map((point) =>
                point.value === null
                  ? [point.label, '—', '—', '—']
                  : [
                      point.label,
                      point.value,
                      point.secondary ?? 0,
                      signed(point.value - (point.secondary ?? 0)),
                    ],
              ),
            }}
          >
            <ColumnChart
              points={flow}
              seriesLabel="joins"
              secondaryLabel="leaves"
              label={`Daily joins and leaves, last ${range} days`}
              height={160}
            />
          </ChartFrame>
        </Panel>

        <Panel level={3} title="Retention" description="Each cohort had the full horizon to leave.">
          <div className="space-y-6">
            <Meter
              label="D7 retention"
              value={members.retention.d7.rate}
              caption={cohortCaption(members.retention.d7, timeZone)}
            />
            <Meter
              label="D30 retention"
              value={members.retention.d30.rate}
              caption={cohortCaption(members.retention.d30, timeZone)}
            />
            <Meter
              label="Onboarded"
              value={members.present > 0 ? members.onboarded / members.present : null}
              caption={`${formatCount(members.onboarded)} of ${formatCount(members.present)} present members completed onboarding.`}
            />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          level={3}
          title="Members present"
          description="Captured once a day, just after midnight UTC."
        >
          <ChartFrame
            title="Present in the guild"
            value={formatCount(latestValue(present.points))}
            table={{
              caption: 'Members present per day',
              columns: ['Day', 'Present'],
              rows: present.points.map((point) => [point.day, point.value ?? '—']),
            }}
          >
            <LineChart
              points={toChartPoints(present.points)}
              seriesLabel="present"
              label={`Members present, last ${range} days`}
              height={120}
            />
          </ChartFrame>
        </Panel>
        <Panel
          level={3}
          title="Referrals"
          description="Joins attributed to a source, and referrals that became VALID."
        >
          <ReadoutGrid
            columns={2}
            items={[
              { label: `Attributed · ${range}D`, value: overview.referrals.attributed },
              { label: `Validated · ${range}D`, value: overview.referrals.validated },
              { label: `Joins · ${range}D`, value: members.joins },
              { label: `Leaves · ${range}D`, value: members.leaves },
            ]}
          />
          <p className="mt-4 text-small text-fg-subtle">
            Referrals become VALID only after the member stays; raw invite volume never counts.
          </p>
          <Link
            href="/referrals"
            className="mt-3 inline-flex items-center gap-1 text-small text-fg-muted hover:text-fg"
          >
            Funnels by inviter and campaign
            <Icon icon={ArrowUpRight} size="sm" />
          </Link>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
