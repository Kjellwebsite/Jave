import { ExternalLink, Inbox } from 'lucide-react';
import { Badge, Card, EmptyState, Icon, Mono, Panel } from '@jave/ui';
import { safeExternalUrl } from '@/lib/safe-url';

export interface SubmissionVersion {
  version: number;
  summary: string;
  links: string[];
  isLate: boolean;
  submittedAt: string;
  submittedBy: string;
}

export interface TeamSubmissions {
  teamId: string;
  teamName: string;
  versions: SubmissionVersion[];
}

/** Links are shown only when they are absolute http(s) URLs, and never followed with our referrer. */
function SubmissionLinks({ links }: { links: readonly string[] }) {
  const safe = links.map(safeExternalUrl).filter((link): link is string => link !== null);
  if (safe.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1">
      {safe.map((link) => (
        <li key={link} className="min-w-0">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex max-w-full items-center gap-1.5 text-small text-fg-muted hover:text-fg"
          >
            <span className="truncate font-mono text-[12px]">{link}</span>
            <Icon icon={ExternalLink} size="sm" className="shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Every version per team, newest first. Evaluators assess the latest; late
 * versions are flagged with no automatic penalty.
 */
export function SubmissionsPanel({ teams }: { teams: readonly TeamSubmissions[] }) {
  if (teams.length === 0)
    return (
      <Card padding="none">
        <EmptyState
          icon={Inbox}
          title="NO TEAMS YET"
          description="Submissions appear here per team, every version kept, once the trial is live."
        />
      </Card>
    );
  return (
    <div className="space-y-4">
      {teams.map((team) => (
        <Panel
          key={team.teamId}
          eyebrow="TEAM"
          title={team.teamName}
          description={
            team.versions.length === 0
              ? 'Nothing submitted.'
              : `${team.versions.length} version${team.versions.length === 1 ? '' : 's'} · evaluators assess v${team.versions[0]!.version}`
          }
          flush
          data-team={team.teamName}
        >
          {team.versions.length === 0 ? (
            <p className="px-5 py-4 text-small text-fg-subtle">
              No submission yet. A team that never submits is INCOMPLETE, never a fail.
            </p>
          ) : (
            <ol className="divide-y divide-line-subtle">
              {team.versions.map((version, index) => (
                <li key={version.version} className="px-5 py-4" data-version={version.version}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={index === 0 ? 'accent' : 'neutral'}>v{version.version}</Badge>
                    {index === 0 ? <Badge tone="neutral">Latest</Badge> : null}
                    {version.isLate ? <Badge tone="warning">Late</Badge> : null}
                    <span className="text-small text-fg-subtle">
                      {version.submittedBy} · <Mono dim>{version.submittedAt}</Mono>
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-body text-fg-muted">
                    {version.summary}
                  </p>
                  <SubmissionLinks links={version.links} />
                </li>
              ))}
            </ol>
          )}
        </Panel>
      ))}
    </div>
  );
}
