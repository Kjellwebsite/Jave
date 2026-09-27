import { can, InvalidStateError, isJaveError, trials } from '@jave/core';
import { Card } from '@jave/ui';
import { ParticipantsPanel, type ParticipantRow } from '@/components/trials/participants-panel';
import { SubmissionsPanel, type TeamSubmissions } from '@/components/trials/submissions-panel';
import { type PreviewData, TeamsPanel, type TeamCardData } from '@/components/trials/teams-panel';
import { firstParam, type SearchParams } from '@/lib/search-params';
import type { StrategyKey } from '@/lib/trial-labels';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import { assignTeamsAction, selectManualAction, selectRandomAction } from './actions';

type StaffView = trials.StaffTrialView;

const ASSIGNABLE: readonly trials.TrialStatus[] = ['recruiting', 'teams_assigned'];
const WHOLE = /^\d{1,2}$/;
const SEED = /^[A-Za-z0-9._:-]{1,64}$/;

export function ParticipantsTab({
  ctx,
  view,
  timeZone,
}: {
  ctx: UserContext;
  view: StaffView;
  timeZone: string;
}) {
  const leads = new Set(
    view.teams.flatMap((team) =>
      team.members.filter((member) => member.role === 'lead').map((member) => member.memberId),
    ),
  );
  const rows: ParticipantRow[] = view.participants.map((participant) => ({
    memberId: participant.memberId,
    displayName: participant.displayName,
    handle: participant.handle,
    status: participant.status,
    teamName: participant.teamName,
    lead: leads.has(participant.memberId),
    statement: participant.statement,
    appliedAt: formatTimestamp(participant.appliedAt, timeZone),
  }));
  return (
    <Card padding="none">
      <ParticipantsPanel
        trialId={view.id}
        rows={rows}
        selectable={view.status === 'recruiting' && can(ctx, 'canManageTrials')}
        maxParticipants={view.maxParticipants}
        randomAction={selectRandomAction}
        manualAction={selectManualAction}
      />
    </Card>
  );
}

function strategyParam(value: string | undefined): StrategyKey {
  return value === 'random' ? 'random' : 'balanced';
}

export async function TeamsTab({
  ctx,
  view,
  params,
}: {
  ctx: UserContext;
  view: StaffView;
  params: SearchParams;
}) {
  const names = new Map(view.participants.map((p) => [p.memberId, p.displayName]));
  const canAssign = ASSIGNABLE.includes(view.status) && can(ctx, 'canManageTrials');
  const strategy = strategyParam(firstParam(params.strategy) ?? view.assignmentStrategy ?? undefined);
  const sizeParam = firstParam(params.size);
  const teamSize = sizeParam && WHOLE.test(sizeParam) ? Number(sizeParam) : view.teamSize;
  const seedParam = firstParam(params.seed)?.trim() ?? '';
  const seed = SEED.test(seedParam) ? seedParam : '';
  const wantsPreview = canAssign && firstParam(params.strategy) !== undefined;

  let preview: PreviewData | null = null;
  let previewError: string | null = null;
  if (wantsPreview) {
    try {
      const planned = await trials.previewTeams(ctx, {
        trialId: view.id,
        strategy,
        teamSize,
        ...(seed ? { seed } : {}),
      });
      preview = {
        strategy: planned.strategy,
        seed: planned.seed,
        teamSize: planned.teamSize,
        teams: planned.teams.map((team) => ({
          name: team.name,
          members: team.memberIds.map((memberId) => ({
            memberId,
            displayName: names.get(memberId) ?? 'member',
            lead: memberId === team.leadMemberId,
          })),
        })),
        ineligible: planned.ineligibleMemberIds.map((id) => names.get(id) ?? 'member'),
      };
    } catch (error) {
      if (!isJaveError(error)) throw error;
      previewError =
        error instanceof InvalidStateError ? error.userMessage : `Preview refused: ${error.userMessage}`;
    }
  }

  const teams: TeamCardData[] = view.teams.map((team) => ({
    id: team.id,
    name: team.name,
    members: team.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      lead: member.role === 'lead',
    })),
    channelId: team.discordChannelId,
    briefed: team.briefedAt !== null,
    archived: team.archivedAt !== null,
    latestVersion: team.submissions[0]?.version ?? null,
    latestLate: team.submissions[0]?.isLate ?? false,
  }));

  return (
    <TeamsPanel
      trialId={view.id}
      canAssign={canAssign}
      reshuffle={view.status === 'teams_assigned'}
      teams={teams}
      selectedCount={view.participants.filter((p) => p.status === 'selected').length}
      defaults={{ strategy, teamSize, seed: preview?.seed ?? seed }}
      preview={preview}
      previewError={previewError}
      guildId={ctx.config.guildId ?? null}
      assignAction={assignTeamsAction}
    />
  );
}

export function SubmissionsTab({ view, timeZone }: { view: StaffView; timeZone: string }) {
  const teams: TeamSubmissions[] = view.teams.map((team) => ({
    teamId: team.id,
    teamName: team.name,
    versions: team.submissions.map((submission) => ({
      version: submission.version,
      summary: submission.summary,
      links: submission.links,
      isLate: submission.isLate,
      submittedAt: formatTimestamp(submission.submittedAt, timeZone),
      submittedBy: submission.submittedBy,
    })),
  }));
  return <SubmissionsPanel teams={teams} />;
}
