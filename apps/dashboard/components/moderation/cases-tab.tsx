import Link from 'next/link';
import { Gavel, Search } from 'lucide-react';
import type { ServiceContext } from '@jave/core';
import {
  Button,
  buttonStyles,
  Callout,
  Card,
  EmptyState,
  Icon,
  Input,
  NativeSelect,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { optionsFrom } from '@/lib/member-labels';
import {
  CASE_ACTION_LABELS,
  CASE_SOURCE_LABELS,
  CASE_STATE_FILTERS,
  type CaseFilters,
} from '@/lib/moderation-labels';
import { toQueryString } from '@/lib/search-params';
import { loadCases } from '@/server/data/moderation';
import { NextLink } from '../next-link';
import { CaseList } from './case-list';

export interface CasesTabProps {
  ctx: ServiceContext;
  filters: CaseFilters;
  timeZone: string;
}

/** Every moderation case, newest first, with filters and pagination. */
export async function CasesTab({ ctx, filters, timeZone }: CasesTabProps) {
  const page = await loadCases(ctx, filters);
  const query = {
    tab: 'cases',
    q: filters.q,
    action: filters.action,
    source: filters.source,
    state: filters.state,
  };
  const filtered = Boolean(filters.q || filters.action || filters.source || filters.state);

  return (
    <Card padding="none">
      <form
        method="get"
        action="/moderation"
        role="search"
        aria-label="Filter cases"
        className="border-b border-line-subtle p-4"
      >
        <input type="hidden" name="tab" value="cases" />
        <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
          <label className="relative col-span-2 min-w-0 md:col-span-4 xl:col-span-1">
            <span className="sr-only">Case number</span>
            <Icon
              icon={Search}
              size="sm"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder="Case number, e.g. CASE-0042"
              maxLength={16}
              mono
              className="pl-8"
            />
          </label>
          <NativeSelect
            name="action"
            aria-label="Action"
            defaultValue={filters.action ?? ''}
            placeholder="Any action"
            options={optionsFrom(CASE_ACTION_LABELS)}
          />
          <NativeSelect
            name="source"
            aria-label="Source"
            defaultValue={filters.source ?? ''}
            placeholder="Any source"
            options={optionsFrom(CASE_SOURCE_LABELS)}
          />
          <NativeSelect
            name="state"
            aria-label="State"
            defaultValue={filters.state ?? ''}
            placeholder="Any state"
            options={optionsFrom(CASE_STATE_FILTERS)}
            className="col-span-2 md:col-span-1"
          />
          <div className="col-span-2 flex gap-2 md:col-span-1">
            <Button type="submit" variant="secondary" className="flex-1 xl:flex-none">
              Apply
            </Button>
            {filtered ? (
              <Link href="/moderation" className={buttonStyles({ variant: 'ghost' })}>
                Reset
              </Link>
            ) : null}
          </div>
        </Toolbar>
        {filters.invalid ? (
          <Callout tone="warning" className="mt-3">
            A filter was not understood and was ignored. Case numbers look like CASE-0042.
          </Callout>
        ) : null}
      </form>

      {page.items.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={filtered ? 'NO MATCHING CASES' : 'NO CASES YET'}
          description={
            filtered
              ? 'No case matches these filters.'
              : 'Warnings, timeouts, quarantines and bans are recorded here as cases.'
          }
          action={
            filtered ? (
              <Link href="/moderation" className={buttonStyles({ variant: 'secondary' })}>
                Clear filters
              </Link>
            ) : null
          }
        />
      ) : (
        <CaseList cases={page.items} timeZone={timeZone} label="Moderation cases" />
      )}

      {page.total > 0 ? (
        <div className="border-t border-line-subtle px-5 py-3">
          <Pagination
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            linkComponent={NextLink}
            label="Cases pagination"
            hrefForOffset={(next) =>
              `/moderation${toQueryString({ ...query, offset: next || undefined })}`
            }
          />
        </div>
      ) : null}
    </Card>
  );
}
