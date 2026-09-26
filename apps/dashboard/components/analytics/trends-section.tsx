import { Card, ChartFrame, ColumnChart, formatCount } from '@jave/ui';
import { coveredDays, seriesTotal, toChartPoints } from '@/lib/analytics-view';
import type { AnalyticsView, TrendMetric } from '@/server/data/analytics';
import { AnalyticsSection } from './readouts';

/** Six outcome flows as small multiples: same scale logic, same hue, one per card. */
const OUTCOME_TRENDS: readonly { metric: TrendMetric; title: string; noun: string }[] = [
  { metric: 'applications.submitted', title: 'Applications submitted', noun: 'submitted' },
  { metric: 'trials.passed', title: 'Trials passed', noun: 'passed' },
  { metric: 'missions.completed', title: 'Missions completed', noun: 'completed' },
  { metric: 'projects.shipped', title: 'Projects shipped', noun: 'shipped' },
  { metric: 'contributions.verified', title: 'Contributions verified', noun: 'verified' },
  { metric: 'referrals.validated', title: 'Referrals validated', noun: 'validated' },
];

export function TrendsSection({ view }: { view: AnalyticsView }) {
  const covered = coveredDays(view.series['members.joins'].points);
  return (
    <AnalyticsSection
      id="trends"
      title="Outcomes over time"
      description={`What was demonstrated each day, from daily snapshots. ${covered} of ${view.range} days captured.`}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {OUTCOME_TRENDS.map(({ metric, title, noun }) => {
          const points = view.series[metric].points;
          return (
            <Card key={metric} padding="md">
              <ChartFrame
                title={title}
                value={formatCount(seriesTotal(points))}
                table={{
                  caption: `${title} per day`,
                  columns: ['Day', title],
                  rows: points.map((point) => [point.day, point.value ?? '—']),
                }}
              >
                <ColumnChart
                  points={toChartPoints(points)}
                  seriesLabel={noun}
                  label={`${title} per day, last ${view.range} days`}
                  height={88}
                />
              </ChartFrame>
            </Card>
          );
        })}
      </div>
    </AnalyticsSection>
  );
}
