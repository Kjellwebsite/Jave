import {
  formatCount,
  Mono,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import {
  AI_REQUEST_STATUS_LABELS,
  AI_REQUEST_STATUS_TONE,
  type AiRequestStatus,
  featureLabel,
} from '@/lib/ai-labels';

/** One ledger row, serializable, times pre-formatted. Never a prompt or an answer. */
export interface LedgerRow {
  id: string;
  time: string;
  feature: string;
  surface: string | null;
  status: AiRequestStatus;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorCode: string | null;
  requesterName: string | null;
  fingerprint: string | null;
}

const MS_PER_SECOND = 1000;

function latency(ms: number): string {
  return ms >= MS_PER_SECOND ? `${(ms / MS_PER_SECOND).toFixed(1)} s` : `${ms} ms`;
}

/**
 * The AI request ledger. Auditors (`everyone`) also see who asked and a
 * short prompt fingerprint that reveals repeats, never content.
 */
export function LedgerTable({ rows, everyone }: { rows: readonly LedgerRow[]; everyone: boolean }) {
  return (
    <Table caption="AI requests" dense>
      <TableHead>
        <tr>
          <TableHeaderCell>Time</TableHeaderCell>
          {everyone ? <TableHeaderCell>Member</TableHeaderCell> : null}
          <TableHeaderCell>Feature</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="hidden md:table-cell">Model</TableHeaderCell>
          <TableHeaderCell className="hidden text-right sm:table-cell">Tokens</TableHeaderCell>
          <TableHeaderCell className="hidden text-right lg:table-cell">Latency</TableHeaderCell>
          {everyone ? (
            <TableHeaderCell className="hidden xl:table-cell">Fingerprint</TableHeaderCell>
          ) : null}
        </tr>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-ledger-row={row.feature}>
            <TableCell>
              <Mono dim className="whitespace-nowrap text-[12px]">
                {row.time}
              </Mono>
            </TableCell>
            {everyone ? (
              <TableCell>
                <span className="text-fg">{row.requesterName ?? 'Unknown member'}</span>
              </TableCell>
            ) : null}
            <TableCell>
              <span className="text-fg">{featureLabel(row.feature)}</span>
              {row.surface ? (
                <span className="type-eyebrow ml-2 text-fg-subtle">{row.surface}</span>
              ) : null}
            </TableCell>
            <TableCell>
              <StatusBadge
                tone={AI_REQUEST_STATUS_TONE[row.status]}
                quiet={row.status === 'ok'}
                label={AI_REQUEST_STATUS_LABELS[row.status].toUpperCase()}
              />
              {row.errorCode ? (
                <Mono dim className="mt-1 block text-[11px]">
                  {row.errorCode}
                </Mono>
              ) : null}
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <Mono dim className="text-[12px]">
                {row.model}
              </Mono>
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">
              <Mono dim className="whitespace-nowrap text-[12px]">
                {formatCount(row.inputTokens)} / {formatCount(row.outputTokens)}
              </Mono>
            </TableCell>
            <TableCell className="hidden text-right lg:table-cell">
              <Mono dim className="text-[12px]">
                {latency(row.latencyMs)}
              </Mono>
            </TableCell>
            {everyone ? (
              <TableCell className="hidden xl:table-cell">
                <Mono dim className="text-[12px]">
                  {row.fingerprint ?? '—'}
                </Mono>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
