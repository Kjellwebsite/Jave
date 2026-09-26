import type { Metadata } from 'next';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';
import { listAuditLogs } from '@jave/core';
import {
  Button,
  buttonStyles,
  Callout,
  Card,
  EmptyState,
  Input,
  Mono,
  NativeSelect,
  PageHeader,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { AuditResultBadge } from '@/components/audit/audit-result-badge';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import {
  AUDIT_FILTER_KEYS,
  describeRejectedFilters,
  parseAuditFilters,
} from '@/lib/audit-filters';
import { formatAuditContext, formatAuditTarget } from '@/lib/audit-view';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 50;
const ROW_GRID = 'md:grid-cols-[132px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_96px]';

const RESULT_OPTIONS = [
  { value: 'success', label: 'Success' },
  { value: 'denied', label: 'Denied' },
  { value: 'failure', label: 'Failure' },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx } = await requireConsoleContext();
  const params = await searchParams;
  const raw = Object.fromEntries(
    AUDIT_FILTER_KEYS.map((key) => [key, firstParam(params[key])?.trim() || undefined]),
  );
  const offset = offsetParam(params.offset);
  // Dates are days in the viewer's time zone — the zone every timestamp below is shown in.
  const viewer = await loadViewer(ctx);
  const filters = parseAuditFilters(raw, viewer.timeZone);
  const rejectedNotice = describeRejectedFilters(filters);

  const result = await guarded(() =>
    listAuditLogs(ctx, { ...filters.query, limit: PAGE_SIZE, offset }),
  );
  if (!result.ok)
    return <RestrictedPage eyebrow="SYSTEM" title="Audit log" capability="canViewAuditLogs" />;
  const page = result.value;
  const filtered = Object.keys(filters.applied).length > 0;
  const submitted = AUDIT_FILTER_KEYS.some((key) => raw[key]);
  const datesApplied = Boolean(filters.applied.since || filters.applied.until);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SYSTEM"
        title="Audit log"
        description="Every sensitive action: actor, action, target, time, context, result. Append-only. Secrets are redacted before storage."
        meta={
          <Mono dim>
            {page.total.toLocaleString('en-US')} {filtered ? 'matching' : 'entries'}
          </Mono>
        }
      />

      <Card padding="none">
        <form
          method="get"
          action="/audit"
          role="search"
          aria-label="Filter audit log"
          className="border-b border-line-subtle p-4"
        >
          <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))_auto]">
            <Input
              name="action"
              defaultValue={raw.action ?? ''}
              placeholder="Action, e.g. role.*"
              aria-label="Action"
              maxLength={64}
              mono
              className="col-span-2 md:col-span-1"
            />
            <NativeSelect
              name="result"
              aria-label="Result"
              defaultValue={raw.result ?? ''}
              placeholder="Any result"
              options={RESULT_OPTIONS}
            />
            <Input
              name="targetType"
              defaultValue={raw.targetType ?? ''}
              placeholder="Target type"
              aria-label="Target type"
              maxLength={32}
              mono
            />
            <Input
              name="targetId"
              defaultValue={raw.targetId ?? ''}
              placeholder="Target ID"
              aria-label="Target ID"
              maxLength={64}
              mono
              className="col-span-2 md:col-span-1"
            />
            <Input
              name="since"
              type="date"
              defaultValue={raw.since ?? ''}
              aria-label="From date"
              mono
            />
            <Input
              name="until"
              type="date"
              defaultValue={raw.until ?? ''}
              aria-label="To date"
              mono
            />
            {filters.applied.actor ? (
              <input type="hidden" name="actor" value={filters.applied.actor} />
            ) : null}
            <div className="col-span-2 flex gap-2 md:col-span-1">
              <Button type="submit" variant="primary" className="flex-1 xl:flex-none">
                Apply
              </Button>
              {submitted ? (
                <Link href="/audit" className={buttonStyles({ variant: 'ghost' })}>
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
          {datesApplied ? (
            <p className="mt-3 text-small text-fg-subtle">
              Dates are whole days in your time zone, <Mono>{viewer.timeZone}</Mono>.
            </p>
          ) : null}
          {rejectedNotice ? (
            <Callout tone="warning" role="note" className="mt-3">
              {rejectedNotice}
            </Callout>
          ) : null}
        </form>

        {page.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtered ? 'NO MATCHING ENTRIES' : 'NO ENTRIES YET'}
            description={
              filtered
                ? 'No audited action matches these filters.'
                : 'Sensitive actions are recorded here as they happen.'
            }
          />
        ) : (
          <div>
            <div
              aria-hidden
              className={`hidden gap-4 border-b border-line px-5 py-2.5 md:grid ${ROW_GRID}`}
            >
              {['Time', 'Actor', 'Action', 'Target', 'Result'].map((label) => (
                <span key={label} className="type-eyebrow text-fg-subtle">
                  {label}
                </span>
              ))}
            </div>
            <ul aria-label="Audit entries" className="divide-y divide-line-subtle">
              {page.items.map((entry) => {
                const context = formatAuditContext(entry.context);
                return (
                  <li key={entry.id} data-action={entry.action}>
                    <details className="group">
                      <summary
                        className={`grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-surface-raised/60 [&::-webkit-details-marker]:hidden ${ROW_GRID}`}
                      >
                        <Mono dim className="order-2 text-[12px] md:order-none">
                          {formatTimestamp(entry.createdAt, viewer.timeZone)}
                        </Mono>
                        <span className="order-3 truncate text-small text-fg-muted md:order-none">
                          {entry.actorName ?? (
                            <span className="type-eyebrow text-fg-subtle">{entry.actorType}</span>
                          )}
                        </span>
                        <Mono className="order-1 truncate text-small text-fg md:order-none">
                          {entry.action}
                        </Mono>
                        <Mono
                          dim
                          className="order-4 hidden truncate text-[12px] md:order-none md:block"
                        >
                          {formatAuditTarget(entry.targetType, entry.targetId)}
                        </Mono>
                        <span className="order-1 justify-self-end md:order-none md:justify-self-start">
                          <AuditResultBadge result={entry.result} />
                        </span>
                      </summary>
                      <div className="space-y-3 border-t border-line-subtle bg-surface-sunken px-5 py-4">
                        <dl className="grid gap-x-6 gap-y-2 text-small sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="type-eyebrow text-fg-subtle">ENTRY</dt>
                            <dd>
                              <Mono>#{entry.id}</Mono>
                            </dd>
                          </div>
                          <div>
                            <dt className="type-eyebrow text-fg-subtle">REQUEST</dt>
                            <dd>
                              <Mono className="break-all">{entry.requestId ?? '—'}</Mono>
                            </dd>
                          </div>
                          <div>
                            <dt className="type-eyebrow text-fg-subtle">TARGET</dt>
                            <dd>
                              <Mono className="break-all">
                                {entry.targetType ?? '—'} {entry.targetId ?? ''}
                              </Mono>
                            </dd>
                          </div>
                          <div>
                            <dt className="type-eyebrow text-fg-subtle">ACTOR</dt>
                            <dd>
                              {entry.actorUserId ? (
                                <Link
                                  href={`/audit${toQueryString({ actor: entry.actorUserId })}`}
                                  className="text-fg-muted underline-offset-4 hover:underline"
                                >
                                  Filter by this actor
                                </Link>
                              ) : (
                                <Mono dim>{entry.actorType}</Mono>
                              )}
                            </dd>
                          </div>
                        </dl>
                        {context ? (
                          <pre className="max-h-80 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed text-fg-muted">
                            {context}
                          </pre>
                        ) : (
                          <p className="text-small text-fg-subtle">No context recorded.</p>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {page.total > 0 ? (
          <div className="border-t border-line-subtle px-5 py-3">
            <Pagination
              offset={page.offset}
              limit={page.limit}
              total={page.total}
              linkComponent={NextLink}
              hrefForOffset={(next) =>
                `/audit${toQueryString({ ...filters.applied, offset: next || undefined })}`
              }
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
