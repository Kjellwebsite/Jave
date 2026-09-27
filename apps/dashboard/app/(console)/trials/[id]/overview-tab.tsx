import type { ReactNode } from 'react';
import { can, trials } from '@jave/core';
import {
  Callout,
  Mono,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { LifecycleControls } from '@/components/trials/lifecycle-controls';
import { StateTrack } from '@/components/trials/state-track';
import { TrialClock } from '@/components/trials/trial-clock';
import { categoryLabel } from '@/lib/trial-labels';
import { dateToZonedInput } from '@/lib/trial-time';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import {
  cancelTrialAction,
  closeSubmissionsAction,
  extendDeadlineAction,
  openRecruitmentAction,
  reprovisionAction,
  startTrialAction,
} from './actions';

export interface OverviewTabProps {
  ctx: UserContext;
  view: trials.StaffTrialView;
  facetLabels: ReadonlyMap<string, string>;
  timeZone: string;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 text-small text-fg-muted">{children}</dd>
    </div>
  );
}

/** State machine, clock, lifecycle controls, facts, sealed brief and rubric. */
export function OverviewTab({ ctx, view, facetLabels, timeZone }: OverviewTabProps) {
  const now = ctx.clock.now();
  const manage = can(ctx, 'canManageTrials');
  const channels = view.teams.filter((team) => team.discordChannelId).length;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <Panel eyebrow="STATE MACHINE" title="Where it stands">
          <div className="space-y-6">
            <StateTrack status={view.status} />
            <div className="grid gap-5 sm:grid-cols-2">
              <TrialClock trial={view} now={now} timeZone={timeZone} stacked />
              {view.startedAt ? (
                <div>
                  <p className="type-eyebrow text-fg-subtle">STARTED</p>
                  <p className="mt-1.5">
                    <Mono>{formatTimestamp(view.startedAt, timeZone)}</Mono>
                  </p>
                </div>
              ) : null}
            </div>
            {view.cancelReason ? (
              <Callout tone="danger" title="CANCELLED">
                {view.cancelReason}
              </Callout>
            ) : null}
          </div>
        </Panel>

        <Panel eyebrow="FACTS" title="Format">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label="CATEGORY">{categoryLabel(view.category)}</Fact>
            <Fact label="DURATION">{trials.formatDuration(view.durationMinutes)}</Fact>
            <Fact label="TEAM SIZE">{view.teamSize}</Fact>
            <Fact label="MAX PARTICIPANTS">{view.maxParticipants ?? 'No cap'}</Fact>
            <Fact label="LATE WINDOW">
              {view.status === 'draft' ||
              view.status === 'recruiting' ||
              view.status === 'teams_assigned'
                ? 'Set at start'
                : `${view.graceMinutes} min`}
            </Fact>
            <Fact label="EVIDENCE FOR">
              {view.facetKeys.length === 0
                ? '—'
                : view.facetKeys.map((key, index) => (
                    <span key={key} className="block">
                      {facetLabels.get(key) ?? key}
                      {index === 0 ? <span className="text-fg-subtle"> · primary</span> : null}
                    </span>
                  ))}
            </Fact>
            <Fact label="RECRUITMENT CLOSES">
              {view.recruitmentClosesAt ? (
                <Mono>{formatTimestamp(view.recruitmentClosesAt, timeZone)}</Mono>
              ) : (
                '—'
              )}
            </Fact>
            <Fact label="SCHEDULED START">
              {view.scheduledStartAt ? (
                <Mono>{formatTimestamp(view.scheduledStartAt, timeZone)}</Mono>
              ) : (
                'Manual'
              )}
            </Fact>
            <Fact label="ASSIGNMENT">
              {view.assignmentSeed ? (
                <>
                  {view.assignmentStrategy} · <Mono>{view.assignmentSeed}</Mono>
                </>
              ) : (
                '—'
              )}
            </Fact>
          </dl>
        </Panel>

        <Panel
          eyebrow="SEALED"
          title="Brief"
          description="Competitors see it only once the trial is live. Staff read it here."
        >
          <p
            className="whitespace-pre-wrap break-words text-body text-fg-muted"
            data-testid="brief"
          >
            {view.brief}
          </p>
        </Panel>

        <Panel eyebrow="RUBRIC" title="What is measured" flush>
          <Table caption="Rubric">
            <TableHead>
              <tr>
                <TableHeaderCell>Criterion</TableHeaderCell>
                <TableHeaderCell className="text-right">Weight</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {view.rubric.map((criterion) => (
                <TableRow key={criterion.key}>
                  <TableCell>
                    <span className="block text-body text-fg">{criterion.label}</span>
                    {criterion.description ? (
                      <span className="mt-0.5 block text-small text-fg-subtle">
                        {criterion.description}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Mono>{criterion.weightPercent}%</Mono>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>

      <div className="min-w-0 space-y-6 lg:sticky lg:top-20">
        <Panel eyebrow="CONTROL" title="Next step">
          {manage ? (
            <LifecycleControls
              trialId={view.id}
              trialRef={view.ref}
              status={view.status}
              durationLabel={trials.formatDuration(view.durationMinutes)}
              recruitmentClosesAt={
                view.recruitmentClosesAt ? dateToZonedInput(view.recruitmentClosesAt, timeZone) : ''
              }
              timeZone={timeZone}
              editable={trials.EDITABLE_STATUSES.includes(view.status)}
              resyncable={
                view.teams.length > 0 &&
                (view.status === 'teams_assigned' || view.status === 'active')
              }
              cancellable={!trials.TERMINAL_STATUSES.includes(view.status)}
              actions={{
                open: openRecruitmentAction,
                start: startTrialAction,
                close: closeSubmissionsAction,
                extend: extendDeadlineAction,
                cancel: cancelTrialAction,
                reprovision: reprovisionAction,
              }}
            />
          ) : (
            <p className="text-small text-fg-subtle">
              You evaluate this trial. Lifecycle controls need canManageTrials.
            </p>
          )}
        </Panel>
        <Panel eyebrow="DISCORD" title="Presence">
          <dl className="space-y-3">
            <Fact label="RECRUITMENT CARD">
              {view.announcement
                ? 'Posted'
                : view.status === 'draft'
                  ? 'Not yet'
                  : 'Pending or no channel'}
            </Fact>
            <Fact label="TEAM CHANNELS">
              {view.teams.length === 0 ? '—' : `${channels} of ${view.teams.length} provisioned`}
            </Fact>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
