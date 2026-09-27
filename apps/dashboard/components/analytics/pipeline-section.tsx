import { BarList, formatCount, Meter, Panel } from '@jave/ui';
import { enumLabel, formatHours } from '@/lib/analytics-view';
import type { AnalyticsView } from '@/server/data/analytics';
import { AnalyticsSection, ReadoutGrid } from './readouts';

function statusItems(byStatus: Readonly<Record<string, number>>) {
  return Object.entries(byStatus).map(([status, value]) => ({
    key: status,
    label: enumLabel(status),
    value,
  }));
}

export function PipelineSection({ view }: { view: AnalyticsView }) {
  const { applications, trials, missions, projects, contributions } = view.overview;
  const range = view.range;
  const decided = applications.accepted + applications.rejected;
  return (
    <AnalyticsSection
      id="pipeline"
      title="Pipeline"
      description={`Applications, trials, missions and projects. Flows count the last ${range} days; status breakdowns are all-time.`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel level={3} title="Applications">
          <div className="space-y-5">
            <ReadoutGrid
              items={[
                { label: 'Submitted', value: applications.submitted },
                { label: 'Accepted', value: applications.accepted },
                { label: 'Rejected', value: applications.rejected },
              ]}
            />
            <Meter
              label="Acceptance rate"
              value={applications.acceptanceRate}
              caption={
                decided > 0
                  ? `${formatCount(applications.accepted)} of ${formatCount(decided)} decisions. Median time to decision ${formatHours(applications.medianHoursToDecision)}.`
                  : 'No decisions in range.'
              }
            />
            <BarList label="Applications by status" items={statusItems(applications.byStatus)} />
          </div>
        </Panel>

        <Panel level={3} title="Trials">
          <div className="space-y-5">
            <ReadoutGrid
              items={[
                { label: 'Completed', value: trials.completed },
                { label: 'Published', value: trials.resultsPublished },
                { label: 'Passed', value: trials.passed },
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
            <BarList label="Trials by status" items={statusItems(trials.byStatus)} />
          </div>
        </Panel>

        <Panel level={3} title="Missions and projects">
          <div className="space-y-5">
            <ReadoutGrid
              columns={2}
              items={[
                { label: 'Missions open', value: missions.open, hint: 'now' },
                { label: 'Missions completed', value: missions.completed, hint: `${range}D` },
                { label: 'Projects shipped', value: projects.shipped, hint: `${range}D` },
                {
                  label: 'Contributions verified',
                  value: contributions.verified,
                  hint: `${range}D`,
                },
              ]}
            />
            <BarList label="Projects by status" items={statusItems(projects.byStatus)} />
          </div>
        </Panel>
      </div>
    </AnalyticsSection>
  );
}
