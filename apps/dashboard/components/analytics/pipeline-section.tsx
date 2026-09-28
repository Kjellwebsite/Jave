import { BarList, formatCount, Meter, Panel } from '@jave/ui';
import { enumLabel, formatHours } from '@/lib/analytics-view';
import type { AnalyticsView } from '@/server/data/analytics';
import {
  AnalyticsSection,
  ReadoutGrid,
  SubHeading,
  THREE_PANEL_GRID,
  WIDE_THIRD,
} from './readouts';

function statusItems(byStatus: Readonly<Record<string, number>>) {
  return Object.entries(byStatus).map(([status, value]) => ({
    key: status,
    label: enumLabel(status),
    value,
  }));
}

export function PipelineSection({ view }: { view: AnalyticsView }) {
  const { applications, trials, missions, projects, contributions } = view.overview;
  const range = `${view.range}D`;
  const decided = applications.accepted + applications.rejected;
  return (
    <AnalyticsSection
      id="pipeline"
      title="Pipeline"
      description={`Applications, trials, missions and projects. Flows cover the last ${view.range} days; stage breakdowns are all-time.`}
    >
      <div className={THREE_PANEL_GRID}>
        <Panel level={3} title="Applications">
          <div className="space-y-5">
            <ReadoutGrid
              columns={2}
              items={[
                { label: 'Submitted', value: applications.submitted, hint: range },
                { label: 'Decided', value: decided, hint: range },
                { label: 'Pending review', value: applications.pending, hint: 'now' },
                {
                  label: 'Decision time',
                  value: formatHours(applications.medianHoursToDecision),
                  hint: `median · ${range}`,
                },
              ]}
            />
            <Meter
              label="Acceptance rate"
              value={applications.acceptanceRate}
              caption={
                decided > 0
                  ? `${formatCount(applications.accepted)} accepted, ${formatCount(applications.rejected)} rejected in range.`
                  : 'No decisions in range.'
              }
            />
            <div>
              <SubHeading>By stage · all time</SubHeading>
              <BarList label="Applications by stage" items={statusItems(applications.byStatus)} />
            </div>
          </div>
        </Panel>

        <Panel level={3} title="Trials">
          <div className="space-y-5">
            <ReadoutGrid
              columns={2}
              items={[
                { label: 'Active', value: trials.active, hint: 'now' },
                { label: 'Completed', value: trials.completed, hint: range },
                { label: 'Published', value: trials.resultsPublished, hint: `results · ${range}` },
                { label: 'Passed', value: trials.passed, hint: range },
              ]}
            />
            <Meter
              label="Pass rate"
              value={trials.passRate}
              caption={
                trials.resultsPublished > 0
                  ? `${formatCount(trials.passed)} of ${formatCount(trials.resultsPublished)} published results passed or earned distinction.`
                  : 'No results published in range.'
              }
            />
            <div>
              <SubHeading>By status · all time</SubHeading>
              <BarList label="Trials by status" items={statusItems(trials.byStatus)} />
            </div>
          </div>
        </Panel>

        <Panel level={3} title="Missions and projects" className={WIDE_THIRD}>
          <div className="space-y-5">
            <ReadoutGrid
              columns={2}
              items={[
                { label: 'Missions open', value: missions.open, hint: 'now' },
                { label: 'Missions done', value: missions.completed, hint: `verified · ${range}` },
                { label: 'Shipped', value: projects.shipped, hint: `projects · ${range}` },
                {
                  label: 'Contributions',
                  value: contributions.verified,
                  hint: `verified · ${range}`,
                },
              ]}
            />
            <div>
              <SubHeading>Projects by status · all time</SubHeading>
              <BarList label="Projects by status" items={statusItems(projects.byStatus)} />
            </div>
          </div>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
