import Link from 'next/link';
import { Award, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  Mono,
  RankBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from '@jave/ui';
import {
  INCOMPLETE_REASON_LABELS,
  OUTCOME_LABELS,
  OUTCOME_TONE,
  type OutcomeKey,
  scoreLabel,
} from '@/lib/trial-labels';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { SelectField } from '../forms/select-field';
import { TRIAL_LIMITS } from '@/lib/trial-limits';

export interface ResultRowData {
  memberId: string;
  displayName: string;
  teamName: string;
  teamScore: number | null;
  individualScore: number | null;
  finalScore: number | null;
  outcome: OutcomeKey;
  incompleteReason: keyof typeof INCOMPLETE_REASON_LABELS | null;
  facetLabel: string | null;
  recommendedRank: string | null;
  rankApplied: boolean;
  /** Rank codes at or below the recommendation, highest first (empty when not applicable). */
  rankOptions: string[];
}

export interface ResultsPanelProps {
  trialId: string;
  published: boolean;
  rows: readonly ResultRowData[];
  counts: Record<OutcomeKey, number>;
  canPublish: boolean;
  canApplyRanks: boolean;
  /** The viewer's own member id: never offered a rank consequence on themselves. */
  viewerMemberId: string | null;
  publishAction: FormAction;
  applyRankAction: FormAction;
}

const RANK_REASON_MAX = TRIAL_LIMITS.rankReason;
const OUTCOME_ORDER: readonly OutcomeKey[] = ['distinction', 'pass', 'fail', 'incomplete'];

/** Outcome first (distinction … incomplete), then the final score, then the name. */
function byOutcome(a: ResultRowData, b: ResultRowData): number {
  return (
    OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome) ||
    (b.finalScore ?? -1) - (a.finalScore ?? -1) ||
    a.displayName.localeCompare(b.displayName)
  );
}

function RankCell({
  row,
  trialId,
  canApply,
  action,
}: {
  row: ResultRowData;
  trialId: string;
  canApply: boolean;
  action: FormAction;
}) {
  if (!row.recommendedRank) return <Mono dim>—</Mono>;
  if (row.rankApplied)
    return (
      <span className="inline-flex items-center gap-2" data-rank-applied="true">
        <RankBadge verifiedRank={row.recommendedRank} size="sm" />
        <span className="text-small text-fg-subtle">
          {row.facetLabel ? `${row.facetLabel} · ` : ''}applied
        </span>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="text-small text-fg-subtle">
        {row.facetLabel ? `${row.facetLabel} · ` : ''}recommends{' '}
        <Mono className="text-fg">{row.recommendedRank}</Mono>
      </span>
      {canApply ? (
        <ConfirmActionDialog
          eyebrow={`RANK CONSEQUENCE · ${row.facetLabel?.toUpperCase() ?? ''}`}
          title="Apply rank consequence"
          description={`Sets ${row.displayName}’s VERIFIED ${row.facetLabel ?? ''} rank from this trial. Recorded as trial evidence and in rank history. Never automatic; applies once.`}
          confirmLabel="Apply verified rank"
          action={action}
          hidden={{ trialId, memberId: row.memberId }}
          trigger={
            <Button size="sm" iconLeft={ShieldCheck} data-testid={`apply-rank-${row.memberId}`}>
              Apply
            </Button>
          }
        >
          <SelectField
            name="rank"
            label="Verified rank"
            description="The recommendation, or lower — a trial is evidence for at most what it measured."
            required
            defaultValue={row.recommendedRank}
            options={row.rankOptions.map((rank) => ({
              value: rank,
              label: rank === row.recommendedRank ? `${rank} — recommended` : rank,
            }))}
          />
          <FormField name="reason" label="Note" description="Optional. Added to the rank history.">
            <Textarea name="reason" maxLength={RANK_REASON_MAX} rows={3} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
    </span>
  );
}

/**
 * Outcomes per competitor. While evaluating: a live preview with the publish
 * control. Once published: final results and the explicit, per-member rank
 * consequence (canModifyRanks), never applied automatically.
 */
export function ResultsPanel({
  trialId,
  published,
  rows,
  counts,
  canPublish,
  canApplyRanks,
  viewerMemberId,
  publishAction,
  applyRankAction,
}: ResultsPanelProps) {
  if (rows.length === 0)
    return (
      <Card padding="none">
        <EmptyState
          icon={Award}
          title="NO RESULTS YET"
          description="Results preview once submissions close, and become final when published."
        />
      </Card>
    );
  const unevaluated = rows.filter((row) => row.incompleteReason === 'not_evaluated').length;
  const ordered = [...rows].sort(byOutcome);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-small text-fg-subtle">
          <Badge tone={published ? 'success' : 'warning'}>
            {published ? 'Published' : 'Preview'}
          </Badge>
          {OUTCOME_ORDER.map((outcome) => (
            <span key={outcome}>
              {OUTCOME_LABELS[outcome]}{' '}
              <Mono className={counts[outcome] > 0 ? 'text-fg' : 'text-fg-subtle'}>
                {counts[outcome]}
              </Mono>
            </span>
          ))}
        </p>
        {!published && canPublish ? (
          <ConfirmActionDialog
            eyebrow="RESULTS"
            title="Publish results"
            description="Results become final and every competitor is notified. Team channels are archived. Rank consequences stay a separate, explicit step."
            confirmLabel="Publish results"
            action={publishAction}
            hidden={{ trialId }}
            trigger={
              <Button variant="primary" data-testid="publish-results">
                Publish results
              </Button>
            }
          >
            {unevaluated > 0 ? (
              <>
                <Callout tone="warning">
                  {unevaluated} participant(s) submitted work that nobody scored. Publishing now
                  records them INCOMPLETE — never as a fail.
                </Callout>
                <Checkbox
                  id="acknowledgeIncomplete"
                  name="acknowledgeIncomplete"
                  label="Publish anyway, marking them incomplete"
                />
              </>
            ) : null}
          </ConfirmActionDialog>
        ) : null}
      </div>
      {!published && unevaluated > 0 ? (
        <Callout tone="warning" title="NOT YET SCORED">
          {unevaluated} competitor(s) submitted work that nobody has scored. Score it in{' '}
          <Link href={`/trials/${trialId}?tab=evaluation`} className="underline underline-offset-4">
            Evaluation
          </Link>{' '}
          first — or publish them as INCOMPLETE, never as a fail.
        </Callout>
      ) : null}
      {!published ? (
        <p className="text-small text-fg-subtle">
          Preview uses today’s thresholds and team weight; they are read again at publish time.
        </p>
      ) : null}
      <Card padding="none">
        <Table caption="Results">
          <TableHead>
            <tr>
              <TableHeaderCell>Competitor</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell text-right">Team</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell text-right">
                Individual
              </TableHeaderCell>
              <TableHeaderCell className="text-right">Final</TableHeaderCell>
              <TableHeaderCell className="text-right">Rank</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {ordered.map((row) => (
              <TableRow key={row.memberId} data-result={row.displayName}>
                <TableCell>
                  <Link
                    href={`/members/${row.memberId}`}
                    className="text-body font-medium text-fg hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone={OUTCOME_TONE[row.outcome]}
                      label={OUTCOME_LABELS[row.outcome].toUpperCase()}
                    />
                    <Mono dim className="text-[12px]">
                      {row.teamName}
                    </Mono>
                    {row.incompleteReason ? (
                      <span className="text-small text-fg-subtle">
                        {INCOMPLETE_REASON_LABELS[row.incompleteReason]}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell text-right">
                  <Mono dim>{scoreLabel(row.teamScore)}</Mono>
                </TableCell>
                <TableCell className="hidden md:table-cell text-right">
                  <Mono dim>{scoreLabel(row.individualScore)}</Mono>
                </TableCell>
                <TableCell className="text-right">
                  <Mono className="text-fg">{scoreLabel(row.finalScore)}</Mono>
                </TableCell>
                <TableCell className="text-right">
                  <RankCell
                    row={row}
                    trialId={trialId}
                    canApply={
                      published &&
                      canApplyRanks &&
                      row.rankOptions.length > 0 &&
                      row.memberId !== viewerMemberId
                    }
                    action={applyRankAction}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
