import { BarList, ChartFrame, ColumnChart, formatCount, Meter, Panel } from '@jave/ui';
import { enumLabel, formatMinutes, seriesTotal, toChartPoints } from '@/lib/analytics-view';
import type { AnalyticsView, TrendMetric } from '@/server/data/analytics';
import { AnalyticsSection, ReadoutGrid } from './readouts';

function breakdown(counts: Readonly<Record<string, number>>) {
  return Object.entries(counts).map(([key, value]) => ({ key, label: enumLabel(key), value }));
}

function DailyColumns({
  view,
  metric,
  title,
  noun,
}: {
  view: AnalyticsView;
  metric: TrendMetric;
  title: string;
  noun: string;
}) {
  const points = view.series[metric].points;
  return (
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
        height={72}
      />
    </ChartFrame>
  );
}

export function SafetySection({ view }: { view: AnalyticsView }) {
  const { tickets, moderation } = view.overview;
  const range = view.range;
  return (
    <AnalyticsSection
      id="safety"
      title="Support and safety"
      description="Response times and load. Counts of actions, never of people."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Tickets">
          <div className="space-y-5">
            <ReadoutGrid
              items={[
                { label: 'Open now', value: tickets.open },
                { label: `Opened · ${range}D`, value: tickets.opened },
                {
                  label: 'Median 1st response',
                  value: formatMinutes(tickets.medianFirstResponseMinutes),
                },
              ]}
            />
            <Meter
              label="SLA breach rate"
              value={tickets.slaBreachRate}
              caption={
                tickets.slaTracked > 0
                  ? `${formatCount(tickets.slaBreached)} of ${formatCount(tickets.slaTracked)} tickets with a known outcome missed the first-response SLA.`
                  : 'No ticket in range has a known SLA outcome yet.'
              }
            />
            <DailyColumns view={view} metric="tickets.opened" title="Opened per day" noun="opened" />
          </div>
        </Panel>

        <Panel title="Moderation cases" description={`By action, last ${range} days.`}>
          <div className="space-y-5">
            <BarList label="Moderation cases by action" items={breakdown(moderation.casesByAction)} />
            <DailyColumns view={view} metric="moderation.cases" title="Cases per day" noun="cases" />
          </div>
        </Panel>

        <Panel title="Security events" description={`By trigger, last ${range} days.`}>
          <div className="space-y-5">
            <BarList
              label="Security events by trigger"
              items={breakdown(moderation.securityEventsByTrigger)}
            />
            <DailyColumns view={view} metric="security.events" title="Events per day" noun="events" />
          </div>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
