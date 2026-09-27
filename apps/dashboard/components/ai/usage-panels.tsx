import { BarChart3 } from 'lucide-react';
import {
  cx,
  EmptyState,
  formatCount,
  Mono,
  Panel,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { AI_REQUEST_STATUS_LABELS, type AiRequestStatus, featureLabel } from '@/lib/ai-labels';

export interface MyUsage {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  enabled: boolean;
}

/** The member's own requests today against the effective daily limit. */
export function YourUsagePanel({ usage }: { usage: MyUsage }) {
  const exhausted = usage.limit > 0 && usage.remaining === 0;
  return (
    <Panel title="Your usage today" description="Counted per UTC day, across Discord and here.">
      <div className="space-y-4">
        <p className="flex items-baseline gap-2">
          <span
            className={cx(
              'font-display text-[34px] font-medium leading-none tabular-nums',
              usage.used === 0 ? 'text-fg-subtle' : 'text-fg',
            )}
          >
            {formatCount(usage.used)}
          </span>
          <span className="text-body text-fg-subtle">/ {formatCount(usage.limit)} requests</span>
        </p>
        <dl className="space-y-1.5 text-small">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Remaining</dt>
            <dd className={exhausted ? 'text-warning' : 'text-fg-muted'}>
              {formatCount(usage.remaining)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-subtle">Resets</dt>
            <dd>
              <Mono dim>{usage.resetsAt}</Mono>
            </dd>
          </div>
        </dl>
        {!usage.enabled ? (
          <p className="text-small text-fg-subtle">JAVE AI is disabled in settings.</p>
        ) : null}
      </div>
    </Panel>
  );
}

export interface OrgUsageView {
  requests: number;
  distinctUsers: number;
  inputTokens: number;
  outputTokens: number;
  byStatus: Record<string, number>;
  byFeature: { feature: string; requests: number; inputTokens: number; outputTokens: number }[];
}

/** Organization totals today (aggregates only — no prompts, no per-member rows). */
export function OrgUsagePanel({ usage }: { usage: OrgUsageView }) {
  const statuses = Object.entries(usage.byStatus).sort(([, a], [, b]) => b - a);
  return (
    <section aria-labelledby="org-usage-heading" className="space-y-4">
      <h2 id="org-usage-heading" className="type-heading text-fg">
        Organization today
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="REQUESTS" value={usage.requests} hint="All outcomes, since 00:00 UTC" />
        <Stat label="MEMBERS" value={usage.distinctUsers} hint="Distinct members using AI" />
        <Stat label="TOKENS IN" value={usage.inputTokens} hint="Prompt tokens billed" />
        <Stat label="TOKENS OUT" value={usage.outputTokens} hint="Answer tokens billed" />
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Answered by feature" flush>
          {usage.byFeature.length === 0 ? (
            <EmptyState
              compact
              icon={BarChart3}
              title="NO ANSWERS TODAY"
              description="Successful requests appear here by feature."
            />
          ) : (
            <Table caption="Answered requests by feature" dense>
              <TableHead>
                <tr>
                  <TableHeaderCell>Feature</TableHeaderCell>
                  <TableHeaderCell className="text-right">Requests</TableHeaderCell>
                  <TableHeaderCell className="hidden text-right sm:table-cell">
                    Tokens in
                  </TableHeaderCell>
                  <TableHeaderCell className="hidden text-right sm:table-cell">
                    Tokens out
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {usage.byFeature.map((row) => (
                  <TableRow key={row.feature}>
                    <TableCell>{featureLabel(row.feature)}</TableCell>
                    <TableCell className="text-right">
                      <Mono>{formatCount(row.requests)}</Mono>
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Mono dim>{formatCount(row.inputTokens)}</Mono>
                    </TableCell>
                    <TableCell className="hidden text-right sm:table-cell">
                      <Mono dim>{formatCount(row.outputTokens)}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
        <Panel title="Outcomes">
          {statuses.length === 0 ? (
            <p className="text-small text-fg-subtle">No requests today.</p>
          ) : (
            <dl className="divide-y divide-line-subtle">
              {statuses.map(([status, total]) => (
                <div key={status} className="flex justify-between gap-3 py-2">
                  <dt className="type-eyebrow text-fg-subtle">
                    {AI_REQUEST_STATUS_LABELS[status as AiRequestStatus] ?? status}
                  </dt>
                  <dd>
                    <Mono>{formatCount(total)}</Mono>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>
      </div>
    </section>
  );
}

export interface MemberUsageRow {
  userId: string;
  displayName: string | null;
  counted: number;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

/** Today's usage per member, heaviest first (audit data: canViewAuditLogs). */
export function MemberUsagePanel({
  rows,
  limit,
}: {
  rows: readonly MemberUsageRow[];
  limit: number;
}) {
  return (
    <Panel
      title="Usage by member today"
      description="Counted requests are the ones that count toward the daily limit. Counts and tokens only."
      flush
    >
      {rows.length === 0 ? (
        <EmptyState
          compact
          title="NO REQUESTS TODAY"
          description="Nobody has used JAVE AI today."
        />
      ) : (
        <Table caption="AI usage by member today" dense>
          <TableHead>
            <tr>
              <TableHeaderCell>Member</TableHeaderCell>
              <TableHeaderCell className="text-right">Counted</TableHeaderCell>
              <TableHeaderCell className="hidden text-right sm:table-cell">
                Attempts
              </TableHeaderCell>
              <TableHeaderCell className="hidden text-right md:table-cell">
                Tokens in
              </TableHeaderCell>
              <TableHeaderCell className="hidden text-right md:table-cell">
                Tokens out
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.userId}>
                <TableCell>
                  <span className="text-fg">{row.displayName ?? 'Unknown member'}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Mono className={row.counted >= limit && limit > 0 ? 'text-warning' : undefined}>
                    {formatCount(row.counted)} / {formatCount(limit)}
                  </Mono>
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Mono dim>{formatCount(row.attempts)}</Mono>
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Mono dim>{formatCount(row.inputTokens)}</Mono>
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Mono dim>{formatCount(row.outputTokens)}</Mono>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
