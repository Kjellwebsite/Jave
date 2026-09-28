import { BarList, ChartFrame, ColumnChart, formatCount, Meter, Panel } from '@jave/ui';
import { enumLabel, formatMinutes, toChartPoints } from '@/lib/analytics-view';
import type { AnalyticsView, TrendMetric } from '@/server/data/analytics';
import {
  AnalyticsSection,
  ReadoutGrid,
  SubHeading,
  THREE_PANEL_GRID,
  WIDE_THIRD,
} from './readouts';

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
  // No total here: the readout above counts the live range (today included),
  // the chart only completed days, and two different totals side by side mislead.
  return (
    <ChartFrame
      title={title}
      description="Completed UTC days."
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
  const range = `${view.range}D`;
  return (
    <AnalyticsSection
      id="safety"
      title="Support and safety"
      description="Response times and load. Counts of actions, never of people."
    >
      <div className={THREE_PANEL_GRID}>
        <Panel level={3} title="Tickets">
          <div className="space-y-5">
            <ReadoutGrid
              columns={2}
              items={[
                { label: 'Open', value: tickets.open, hint: 'now' },
                { label: 'Opened', value: tickets.opened, hint: range },
                {
                  label: 'First response',
                  value: formatMinutes(tickets.medianFirstResponseMinutes),
                  hint: `median · ${range}`,
                },
                {
                  label: 'SLA breaches',
                  value: tickets.slaBreached,
                  hint: `of ${formatCount(tickets.slaTracked)} tracked`,
                },
              ]}
            />
            <Meter
              label="SLA breach rate"
              value={tickets.slaBreachRate}
              caption={
                tickets.slaTracked > 0
                  ? 'Tickets opened in range whose first response missed the SLA, of those with a known outcome.'
                  : 'No ticket in range has a known SLA outcome yet.'
              }
            />
            <DailyColumns
              view={view}
              metric="tickets.opened"
              title="Opened per day"
              noun="opened"
            />
          </div>
        </Panel>

        <Panel level={3} title="Moderation cases">
          <div className="space-y-5">
            <div>
              <SubHeading>By action · {range}</SubHeading>
              <BarList
                label="Moderation cases by action"
                items={breakdown(moderation.casesByAction)}
              />
            </div>
            <DailyColumns
              view={view}
              metric="moderation.cases"
              title="Cases per day"
              noun="cases"
            />
          </div>
        </Panel>

        <Panel level={3} title="Security events" className={WIDE_THIRD}>
          <div className="space-y-5">
            <div>
              <SubHeading>By trigger · {range}</SubHeading>
              <BarList
                label="Security events by trigger"
                items={breakdown(moderation.securityEventsByTrigger)}
              />
            </div>
            <DailyColumns
              view={view}
              metric="security.events"
              title="Events per day"
              noun="events"
            />
          </div>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
