import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { ai, can } from '@jave/core';
import {
  Button,
  buttonStyles,
  Card,
  EmptyState,
  NativeSelect,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { type LedgerRow, LedgerTable } from '@/components/ai/ledger-table';
import { NextLink } from '@/components/next-link';
import { AI_FEATURE_LABELS, AI_REQUEST_STATUS_LABELS, type AiRequestStatus } from '@/lib/ai-labels';
import { optionsFrom } from '@/lib/member-labels';
import { toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';

export const LEDGER_PAGE_SIZE = 50;

export interface LedgerFilters {
  feature?: (typeof ai.AI_FEATURES)[number];
  status?: AiRequestStatus;
}

const FEATURE_OPTIONS = ai.AI_FEATURES.map((feature) => ({
  value: feature,
  label: AI_FEATURE_LABELS[feature] ?? feature,
}));

/** The request ledger: metadata only. Auditors see everyone's, everyone else their own. */
export async function LedgerSection({
  ctx,
  timeZone,
  filters,
  offset,
}: {
  ctx: UserContext;
  timeZone: string;
  filters: LedgerFilters;
  offset: number;
}) {
  const everyone = can(ctx, 'canViewAuditLogs');
  const page = await ai.listAiRequests(ctx, {
    scope: everyone ? 'all' : 'mine',
    feature: filters.feature,
    status: filters.status,
    limit: LEDGER_PAGE_SIZE,
    offset,
  });
  const filtered = Boolean(filters.feature || filters.status);
  const rows: LedgerRow[] = page.items.map((item) => ({
    id: item.id,
    time: formatTimestamp(item.createdAt, timeZone),
    feature: item.feature,
    surface: item.surface,
    status: item.status,
    model: item.model,
    inputTokens: item.inputTokens,
    outputTokens: item.outputTokens,
    latencyMs: item.latencyMs,
    errorCode: item.errorCode,
    requesterName: item.requester?.displayName ?? null,
    fingerprint: item.fingerprint,
  }));

  return (
    <Card padding="none">
      <form
        method="get"
        action="/ai"
        role="search"
        aria-label="Filter AI requests"
        className="border-b border-line-subtle p-4"
      >
        <input type="hidden" name="tab" value="ledger" />
        <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <NativeSelect
            name="feature"
            aria-label="Feature"
            defaultValue={filters.feature ?? ''}
            placeholder="Any feature"
            options={FEATURE_OPTIONS}
          />
          <NativeSelect
            name="status"
            aria-label="Status"
            defaultValue={filters.status ?? ''}
            placeholder="Any status"
            options={optionsFrom(AI_REQUEST_STATUS_LABELS)}
          />
          <div className="col-span-2 flex gap-2 md:col-span-1">
            <Button type="submit" variant="primary" className="flex-1 md:flex-none">
              Apply
            </Button>
            {filtered ? (
              <Link href="/ai?tab=ledger" className={buttonStyles({ variant: 'ghost' })}>
                Reset
              </Link>
            ) : null}
          </div>
        </Toolbar>
        <p className="mt-3 text-small text-fg-subtle">
          {everyone
            ? 'Every AI request in the organization. Prompts and answers are never stored — the fingerprint only shows repeats.'
            : 'Your AI requests. Prompts and answers are never stored.'}
        </p>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? 'NO MATCHING REQUESTS' : 'NO REQUESTS YET'}
          description={
            filtered
              ? 'No AI request matches these filters.'
              : 'Requests from Discord and the dashboard are recorded here as they happen.'
          }
        />
      ) : (
        <LedgerTable rows={rows} everyone={everyone} />
      )}
      {page.total > 0 ? (
        <div className="border-t border-line-subtle px-5 py-3">
          <Pagination
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            linkComponent={NextLink}
            hrefForOffset={(next) =>
              `/ai${toQueryString({ tab: 'ledger', ...filters, offset: next || undefined })}`
            }
          />
        </div>
      ) : null}
    </Card>
  );
}
