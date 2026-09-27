import { ClipboardList } from 'lucide-react';
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  Mono,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { scoreLabel } from '@/lib/trial-labels';
import type { FormAction } from '../forms/action-form';
import { type ScoreCriterion, ScoreDialog, type ScoreTarget } from './score-dialog';

export interface EvaluationRow {
  id: string;
  evaluatorName: string;
  mine: boolean;
  /** 'Team' or the participant's name. */
  targetLabel: string;
  individual: boolean;
  scores: Record<string, number>;
  overallScore: number;
  notes: string | null;
  updatedAt: string;
}

export interface EvaluationTeam {
  id: string;
  name: string;
  latestVersion: number | null;
  latestLate: boolean;
  /** Team score from the service's results preview (mean of team evaluations), when known. */
  teamScore: number | null;
  evaluations: EvaluationRow[];
  targets: ScoreTarget[];
}

export interface EvaluationPanelProps {
  trialId: string;
  criteria: readonly ScoreCriterion[];
  teams: readonly EvaluationTeam[];
  /** evaluating and the viewer holds canEvaluateTrials. */
  canScore: boolean;
  scoringClosedReason: string | null;
  action: FormAction;
}

const RULES = [
  'Nobody evaluates a trial they applied to — this page is closed to them — and nobody scores themselves.',
  'Every criterion is scored 0–10. Your re-score replaces your earlier evaluation of the same target.',
  'Late work is flagged, never penalised automatically. You judge it.',
  'A team with no submission, or work nobody scored, is INCOMPLETE — never a fail.',
];

function ScoreGrid({
  criteria,
  team,
}: {
  criteria: readonly ScoreCriterion[];
  team: EvaluationTeam;
}) {
  return (
    <Table caption={`Scores — ${team.name}`} dense>
      <TableHead>
        <tr>
          <TableHeaderCell>Evaluator</TableHeaderCell>
          {criteria.map((criterion) => (
            <TableHeaderCell key={criterion.key} className="text-right">
              <span className="block">{criterion.label}</span>
              <span className="block text-fg-faint">{criterion.weightPercent}%</span>
            </TableHeaderCell>
          ))}
          <TableHeaderCell className="text-right">Weighted</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {team.evaluations.map((evaluation) => (
          <TableRow key={evaluation.id} data-evaluation={evaluation.mine ? 'mine' : 'other'}>
            <TableCell>
              <span className="block text-small text-fg">
                {evaluation.evaluatorName}
                {evaluation.mine ? <span className="text-fg-subtle"> (you)</span> : null}
              </span>
              <span className="block text-small text-fg-subtle">
                {evaluation.individual ? `Individual — ${evaluation.targetLabel}` : 'Team'} ·{' '}
                <Mono dim className="text-[11px]">
                  {evaluation.updatedAt}
                </Mono>
              </span>
              {evaluation.notes ? (
                <span className="mt-1 block max-w-xs whitespace-pre-wrap break-words text-small text-fg-muted">
                  {evaluation.notes}
                </span>
              ) : null}
            </TableCell>
            {criteria.map((criterion) => (
              <TableCell key={criterion.key} className="text-right">
                <Mono>{evaluation.scores[criterion.key] ?? '—'}</Mono>
              </TableCell>
            ))}
            <TableCell className="text-right">
              <Mono className="text-fg">{scoreLabel(evaluation.overallScore)}</Mono>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Rubric score grid per team (team and individual evaluations) with weighted totals. */
export function EvaluationPanel({
  trialId,
  criteria,
  teams,
  canScore,
  scoringClosedReason,
  action,
}: EvaluationPanelProps) {
  return (
    <div className="space-y-6">
      <Callout tone="info" title="EVALUATOR RULES">
        <ul className="list-disc space-y-1 pl-4">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Callout>
      {scoringClosedReason ? (
        <p role="status" className="text-small text-fg-subtle">
          {scoringClosedReason}
        </p>
      ) : null}
      {teams.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={ClipboardList}
            title="NOTHING TO EVALUATE"
            description="Teams appear here once they exist; scoring opens when submissions close."
          />
        </Card>
      ) : (
        teams.map((team) => (
          <Panel
            key={team.id}
            eyebrow="TEAM"
            title={team.name}
            flush
            data-team={team.name}
            description={
              team.latestVersion === null
                ? 'No submission — INCOMPLETE unless individuals are scored.'
                : `Assessing v${team.latestVersion}${team.latestLate ? ' · submitted late' : ''}`
            }
            actions={
              <span className="flex items-center gap-2">
                {team.teamScore !== null ? (
                  <Badge tone="accent">Team {scoreLabel(team.teamScore)}</Badge>
                ) : null}
                {canScore ? (
                  <ScoreDialog
                    trialId={trialId}
                    teamName={team.name}
                    criteria={criteria}
                    targets={team.targets}
                    action={action}
                  />
                ) : null}
              </span>
            }
          >
            {team.evaluations.length === 0 ? (
              <p className="px-5 py-4 text-small text-fg-subtle">Not scored yet.</p>
            ) : (
              <ScoreGrid criteria={criteria} team={team} />
            )}
          </Panel>
        ))
      )}
    </div>
  );
}
