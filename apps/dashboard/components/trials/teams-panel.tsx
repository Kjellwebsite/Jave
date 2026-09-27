import Link from 'next/link';
import { ExternalLink, UsersRound } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  Mono,
  NativeSelect,
  StatusBadge,
} from '@jave/ui';
import { STRATEGY_LABELS, type StrategyKey } from '@/lib/trial-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';

export interface TeamMemberRow {
  memberId: string;
  displayName: string;
  lead: boolean;
}

export interface TeamCardData {
  id: string;
  name: string;
  members: TeamMemberRow[];
  channelId: string | null;
  briefed: boolean;
  archived: boolean;
  latestVersion: number | null;
  latestLate: boolean;
}

export interface PreviewData {
  strategy: StrategyKey;
  seed: string;
  teamSize: number;
  teams: { name: string; members: TeamMemberRow[] }[];
  ineligible: string[];
}

export interface TeamsPanelProps {
  trialId: string;
  /** recruiting or teams_assigned, and the viewer manages trials. */
  canAssign: boolean;
  reshuffle: boolean;
  teams: readonly TeamCardData[];
  selectedCount: number;
  defaults: { strategy: StrategyKey; teamSize: number; seed: string };
  preview: PreviewData | null;
  /** Why the preview could not be computed (e.g. nobody selected yet). */
  previewError: string | null;
  guildId: string | null;
  assignAction: FormAction;
}

const SEED_MAX = 64;
const MAX_TEAM_SIZE = 12;

function discordChannelUrl(guildId: string | null, channelId: string): string | null {
  return guildId ? `https://discord.com/channels/${guildId}/${channelId}` : null;
}

function Roster({ members }: { members: readonly TeamMemberRow[] }) {
  return (
    <ul className="space-y-1.5">
      {members.map((member) => (
        <li key={member.memberId} className="flex min-w-0 items-center justify-between gap-3">
          <Link
            href={`/members/${member.memberId}`}
            className="truncate text-small text-fg-muted hover:text-fg"
          >
            {member.displayName}
          </Link>
          {member.lead ? <Badge tone="accent">Lead</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function ChannelState({ team, guildId }: { team: TeamCardData; guildId: string | null }) {
  if (!team.channelId)
    return <StatusBadge tone="warning" label="CHANNEL PENDING" />;
  const url = discordChannelUrl(guildId, team.channelId);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatusBadge
        tone={team.archived ? 'neutral' : 'success'}
        quiet
        label={team.archived ? 'ARCHIVED' : team.briefed ? 'BRIEFED' : 'CHANNEL READY'}
      />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-small text-fg-subtle hover:text-fg"
        >
          Open in Discord
          <Icon icon={ExternalLink} size="sm" />
        </a>
      ) : (
        <Mono dim className="text-[12px]">
          #{team.channelId}
        </Mono>
      )}
    </span>
  );
}

/**
 * Team assignment and the teams as they stand. The preview is a dry run of
 * the exact assignment (same selection, strategy and seed); ASSIGN commits
 * that seed, so what was previewed is what is created.
 */
export function TeamsPanel({
  trialId,
  canAssign,
  reshuffle,
  teams,
  selectedCount,
  defaults,
  preview,
  previewError,
  guildId,
  assignAction,
}: TeamsPanelProps) {
  return (
    <div className="space-y-6">
      {canAssign ? (
        <Card as="section" aria-label="Team assignment" padding="md" className="space-y-5">
          <div className="space-y-1">
            <p className="type-eyebrow text-fg-subtle">{reshuffle ? 'REASSIGN' : 'ASSIGN'}</p>
            <h2 className="type-heading text-fg">Team assignment</h2>
            <p className="text-small text-fg-subtle">
              {selectedCount} selected. Preview a seeded assignment, then commit exactly that
              result.{' '}
              {reshuffle
                ? 'Reassigning replaces every team; their Discord channels are torn down and rebuilt.'
                : 'Unselected applicants are waitlisted.'}
            </p>
          </div>
          <form
            method="get"
            action={`/trials/${trialId}`}
            className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_120px_minmax(0,1fr)_auto] sm:items-end"
            aria-label="Preview teams"
          >
            <input type="hidden" name="tab" value="teams" />
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-small font-medium text-fg-muted">Strategy</span>
              <NativeSelect
                name="strategy"
                defaultValue={defaults.strategy}
                options={Object.entries(STRATEGY_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-small font-medium text-fg-muted">Team size</span>
              <Input
                name="size"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_TEAM_SIZE}
                defaultValue={defaults.teamSize}
                mono
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-small font-medium text-fg-muted">Seed</span>
              <Input
                name="seed"
                defaultValue={defaults.seed}
                placeholder="generated"
                maxLength={SEED_MAX}
                mono
                spellCheck={false}
              />
            </label>
            <Button type="submit" data-testid="preview-teams">
              Preview
            </Button>
          </form>

          {previewError ? (
            <p role="status" className="text-small text-warning">
              {previewError}
            </p>
          ) : null}

          {preview ? (
            <div className="space-y-4 border-t border-line-subtle pt-5" data-testid="team-preview">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-small text-fg-subtle">
                  PREVIEW · {preview.teams.length} teams · {STRATEGY_LABELS[preview.strategy]} ·
                  seed <Mono className="text-fg">{preview.seed}</Mono>
                </p>
                <ConfirmActionDialog
                  eyebrow="TEAMS"
                  title={reshuffle ? 'Reassign teams' : 'Assign teams'}
                  description={`Creates exactly the ${preview.teams.length} previewed teams. Private Discord channels are provisioned; members are told their team.${reshuffle ? ' The current teams and their channels are replaced.' : ''}`}
                  confirmLabel={reshuffle ? 'Reassign teams' : 'Assign teams'}
                  tone={reshuffle ? 'danger' : 'default'}
                  action={assignAction}
                  hidden={{
                    trialId,
                    strategy: preview.strategy,
                    teamSize: String(preview.teamSize),
                    seed: preview.seed,
                  }}
                  trigger={
                    <Button variant="primary" data-testid="assign-teams">
                      {reshuffle ? 'Reassign these teams' : 'Assign these teams'}
                    </Button>
                  }
                />
              </div>
              {preview.ineligible.length > 0 ? (
                <p className="text-small text-warning">
                  {preview.ineligible.length} selected member(s) are no longer eligible and will be
                  removed: {preview.ineligible.join(', ')}.
                </p>
              ) : null}
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {preview.teams.map((team) => (
                  <li key={team.name} className="rounded-md border border-dashed border-line-strong p-4">
                    <p className="type-eyebrow text-fg-muted">{team.name}</p>
                    <div className="mt-3">
                      <Roster members={team.members} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {teams.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={UsersRound}
            title="NO TEAMS YET"
            description="Teams are formed from the selected participants once recruitment is done."
          />
        </Card>
      ) : (
        <ul aria-label="Teams" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <li key={team.id} data-team={team.name}>
              <Card padding="md" className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="type-eyebrow text-fg">{team.name}</p>
                    <p className="mt-1 text-small text-fg-subtle">
                      {team.members.length} member{team.members.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {team.latestVersion !== null ? (
                    <Badge tone={team.latestLate ? 'warning' : 'success'}>
                      v{team.latestVersion}
                      {team.latestLate ? ' · late' : ''}
                    </Badge>
                  ) : null}
                </div>
                <Roster members={team.members} />
                <div className="mt-auto border-t border-line-subtle pt-3">
                  <ChannelState team={team} guildId={guildId} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
