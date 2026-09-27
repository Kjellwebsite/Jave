import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Pencil } from 'lucide-react';
import { can, isUuid, missions } from '@jave/core';
import { Badge, Callout, Icon, LinkTabs, Mono, Panel, StatusBadge, buttonStyles } from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { AssignmentTable } from '@/components/missions/assignment-table';
import { AssignDialog } from '@/components/missions/assign-dialog';
import { LifecycleControls } from '@/components/missions/lifecycle-controls';
import { OwnAssignmentActions } from '@/components/missions/own-assignment-actions';
import { ReviewQueue } from '@/components/missions/review-queue';
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_TONE,
  holdingLabel,
  MISSION_STATUS_LABELS,
  MISSION_STATUS_TONE,
  MISSION_TYPE_LABELS,
} from '@/lib/mission-labels';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { assignCandidates, facetLabels, isMissionStaff } from '@/server/data/missions';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import {
  abandonMissionAction,
  acceptMissionAction,
  archiveMissionAction,
  assignMissionAction,
  closeMissionAction,
  publishMissionAction,
  rejectSubmissionAction,
  reopenMissionAction,
  submitMissionAction,
  verifySubmissionAction,
} from '../actions';

export const metadata: Metadata = { title: 'Mission' };

const TABS = ['assignments', 'review'] as const;
type Tab = (typeof TABS)[number];
const SAVED_COPY: Record<string, string> = {
  created: 'DRAFT CREATED — publish it when the brief is final.',
  updated: 'MISSION UPDATED — a posted Discord card follows the change.',
};

function rewardText(reward: missions.MissionReward | null): string {
  if (!reward) return '—';
  return reward.hidden
    ? `Hidden achievement · ${reward.rarity}`
    : `${reward.title} · ${reward.rarity}`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 break-words text-small text-fg-muted">{children}</dd>
    </div>
  );
}

export default async function MissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => missions.getMissionDetail(ctx, { missionId: id }));
  if (!loaded.ok) notFound();
  const detail = loaded.value;
  const { mission } = detail;
  const query = await searchParams;
  const [viewer, facets] = await Promise.all([loadViewer(ctx), facetLabels(ctx)]);
  const tz = viewer.timeZone;
  const staff = isMissionStaff(ctx);
  const manage = can(ctx, 'canManageMissions');
  const headline = `${mission.number} — ${mission.title}`;
  const awaiting = detail.assignments?.filter((row) => row.status === 'submitted').length ?? 0;
  const savedKey = firstParam(query.saved) ?? '';
  // "Draft created" only while it is one: after publishing, the page revalidates in place.
  const saved =
    Object.hasOwn(SAVED_COPY, savedKey) && (savedKey !== 'created' || mission.status === 'draft')
      ? SAVED_COPY[savedKey]
      : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-5 border-b border-line-subtle pb-7 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2.5">
          <Link
            href="/missions"
            className="type-eyebrow inline-flex items-center gap-1.5 text-fg-subtle hover:text-fg"
          >
            <Icon icon={ArrowLeft} size="sm" />
            MISSIONS / {mission.number}
          </Link>
          <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
            {mission.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              quiet={mission.status === 'open'}
              tone={MISSION_STATUS_TONE[mission.status]}
              label={MISSION_STATUS_LABELS[mission.status].toUpperCase()}
            />
            <Badge>{MISSION_TYPE_LABELS[mission.type]}</Badge>
            {staff && !mission.selfAssignable ? <Badge tone="info">Staff-assigned</Badge> : null}
          </div>
        </div>
        {manage && mission.status !== 'archived' ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href={`/missions/${mission.id}/edit`}
              className={buttonStyles({ variant: 'secondary' })}
            >
              <Icon icon={Pencil} size="sm" />
              Edit
            </Link>
            <LifecycleControls
              missionId={mission.id}
              headline={headline}
              status={mission.status}
              awaitingReview={awaiting}
              actions={{
                publish: publishMissionAction,
                close: closeMissionAction,
                reopen: reopenMissionAction,
                archive: archiveMissionAction,
              }}
            />
          </div>
        ) : null}
      </header>

      {saved ? (
        <Callout tone="success" role="status">
          {saved}
        </Callout>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Fact label="CAPABILITY">
          {mission.facetKey ? (facets.get(mission.facetKey) ?? mission.facetKey) : '—'}
        </Fact>
        <Fact label="SLOTS">
          {mission.type === 'team'
            ? 'Teams formed by staff'
            : holdingLabel(detail.assigneeCount, mission.maxAssignees)}
        </Fact>
        <Fact label="DEADLINE">
          <Mono>{mission.deadlineAt ? `${formatTimestamp(mission.deadlineAt, tz)}` : '—'}</Mono>
        </Fact>
        <Fact label="TIME LIMIT">
          {mission.durationHours ? `${mission.durationHours}h per assignment` : '—'}
        </Fact>
        <Fact label="EVIDENCE">{mission.evidenceRequired ? 'Required' : 'Optional'}</Fact>
        <Fact label="REWARD">{rewardText(mission.reward)}</Fact>
        <Fact label="REWARD NOTE">{mission.rewardNote ?? '—'}</Fact>
        <Fact label="PUBLISHED">
          <Mono>{mission.publishedAt ? formatTimestamp(mission.publishedAt, tz) : '—'}</Mono>
        </Fact>
      </dl>

      <Panel title="Brief">
        <p className="whitespace-pre-wrap break-words text-body text-fg-muted">{mission.brief}</p>
      </Panel>

      {detail.myAssignment || (mission.status === 'open' && ctx.actor.memberId) ? (
        <OwnAssignment detail={detail} headline={headline} timeZone={tz} />
      ) : null}

      {staff && detail.assignments ? (
        <StaffSections
          ctx={ctx}
          detail={detail}
          headline={headline}
          tab={
            (TABS as readonly string[]).includes(firstParam(query.tab) ?? '')
              ? (firstParam(query.tab) as Tab)
              : 'assignments'
          }
          awaiting={awaiting}
          timeZone={tz}
        />
      ) : null}
    </div>
  );
}

function OwnAssignment({
  detail,
  headline,
  timeZone,
}: {
  detail: missions.MissionDetail;
  headline: string;
  timeZone: string;
}) {
  const { mission, myAssignment: own } = detail;
  const takeable =
    !own &&
    mission.status === 'open' &&
    mission.selfAssignable &&
    mission.type !== 'team' &&
    detail.slotsLeft !== 0;
  if (!own && !takeable) return null;
  const canSubmit =
    own !== null &&
    own.status !== 'assigned' &&
    missions.canTransitionAssignment(own.status, 'submitted') &&
    own.attempts < missions.MAX_SUBMISSION_ATTEMPTS;
  return (
    <Panel
      title="Your assignment"
      description={
        own
          ? 'Only you and mission staff see this.'
          : 'Take this mission. Verified work becomes evidence on your record.'
      }
      actions={
        <OwnAssignmentActions
          missionId={mission.id}
          headline={headline}
          canAccept={takeable || own?.status === 'assigned'}
          canSubmit={canSubmit}
          canAbandon={own !== null && missions.canTransitionAssignment(own.status, 'abandoned')}
          evidenceRequired={mission.evidenceRequired}
          team={mission.type === 'team'}
          previousSubmission={own?.status === 'rejected' ? own.submission : null}
          acceptAction={acceptMissionAction}
          submitAction={submitMissionAction}
          abandonAction={abandonMissionAction}
        />
      }
    >
      {own ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label="STATUS">
            <StatusBadge
              tone={ASSIGNMENT_STATUS_TONE[own.status]}
              label={ASSIGNMENT_STATUS_LABELS[own.status].toUpperCase()}
            />
          </Fact>
          <Fact label="DUE">
            <Mono>{own.dueAt ? formatTimestamp(own.dueAt, timeZone) : '—'}</Mono>
          </Fact>
          <Fact label="ATTEMPTS">
            <Mono>
              {own.attempts} / {missions.MAX_SUBMISSION_ATTEMPTS}
            </Mono>
          </Fact>
          <Fact label="TEAM">{own.teamKey ? <Mono>{own.teamKey}</Mono> : '—'}</Fact>
          {own.feedback ? (
            <div className="col-span-2 sm:col-span-4">
              <dt className="type-eyebrow text-fg-subtle">FEEDBACK</dt>
              <dd className="mt-1.5 whitespace-pre-wrap break-words text-small text-fg-muted">
                {own.feedback}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-small text-fg-subtle">
          {detail.slotsLeft === null
            ? 'Open to every member.'
            : `${detail.slotsLeft} slot(s) left.`}
        </p>
      )}
    </Panel>
  );
}

async function StaffSections({
  ctx,
  detail,
  headline,
  tab,
  awaiting,
  timeZone,
}: {
  ctx: UserContext;
  detail: missions.MissionDetail;
  headline: string;
  tab: Tab;
  awaiting: number;
  timeZone: string;
}) {
  const { mission } = detail;
  const assignments = detail.assignments ?? [];
  const canAssign = can(ctx, 'canManageMissions') && mission.status === 'open';
  const base = `/missions/${mission.id}`;
  // Holders cannot be assigned again; those who walked away or expired can be.
  const holding = new Set(
    assignments
      .filter((row) => row.status !== 'abandoned' && row.status !== 'expired')
      .map((row) => row.memberId),
  );
  const candidates = canAssign && tab === 'assignments' ? await assignCandidates(ctx, holding) : [];
  return (
    <div className="space-y-6">
      <LinkTabs
        label="Mission sections"
        linkComponent={NextLink}
        tabs={[
          {
            href: base,
            label: 'Assignments',
            active: tab === 'assignments',
            meta: (
              <Mono dim className="text-[11px]">
                {assignments.length}
              </Mono>
            ),
          },
          {
            href: `${base}?tab=review`,
            label: 'Review queue',
            active: tab === 'review',
            meta:
              awaiting > 0 ? (
                <Badge tone="warning">{awaiting}</Badge>
              ) : (
                <Mono dim className="text-[11px]">
                  0
                </Mono>
              ),
          },
        ]}
      />
      {tab === 'assignments' ? (
        <Panel
          title="Assignments"
          description="Everyone who holds or held this mission, with their state."
          actions={
            canAssign ? (
              <AssignDialog
                missionId={mission.id}
                headline={headline}
                team={mission.type === 'team'}
                candidates={candidates}
                action={assignMissionAction}
              />
            ) : null
          }
          flush
        >
          <AssignmentTable assignments={assignments} timeZone={timeZone} />
        </Panel>
      ) : (
        <ReviewQueue
          ctx={ctx}
          missionId={mission.id}
          timeZone={timeZone}
          verifyAction={verifySubmissionAction}
          rejectAction={rejectSubmissionAction}
        />
      )}
    </div>
  );
}
