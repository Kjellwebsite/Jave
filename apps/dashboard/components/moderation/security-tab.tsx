import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { ServiceContext } from '@jave/core';
import {
  Button,
  buttonStyles,
  Callout,
  Card,
  EmptyState,
  NativeSelect,
  Pagination,
  Toolbar,
} from '@jave/ui';
import { optionsFrom } from '@/lib/member-labels';
import {
  EVENT_VIEW_FILTERS,
  type EventFilters,
  MIN_RISK_FILTERS,
  TRIGGER_LABELS,
} from '@/lib/moderation-labels';
import { toQueryString } from '@/lib/search-params';
import { loadRiskThresholds, loadSecurityEvents } from '@/server/data/moderation';
import { NextLink } from '../next-link';
import { EventList } from './event-list';

const SECURITY_TAB_HREF = '/moderation?tab=security';

export interface SecurityTabProps {
  ctx: ServiceContext;
  filters: EventFilters;
  timeZone: string;
}

/** Security events for triage: needs-review first, risk meters, evidence excerpts. */
export async function SecurityTab({ ctx, filters, timeZone }: SecurityTabProps) {
  const [page, thresholds] = await Promise.all([
    loadSecurityEvents(ctx, filters),
    loadRiskThresholds(ctx),
  ]);
  const query = {
    tab: 'security',
    view: filters.view === 'review' ? undefined : filters.view,
    trigger: filters.trigger,
    minRisk: filters.minRisk,
  };
  const filtered = Boolean(query.view || filters.trigger || filters.minRisk !== undefined);

  return (
    <Card padding="none">
      <form
        method="get"
        action="/moderation"
        role="search"
        aria-label="Filter security events"
        className="border-b border-line-subtle p-4"
      >
        <input type="hidden" name="tab" value="security" />
        <Toolbar className="grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <NativeSelect
            name="view"
            aria-label="Review status"
            defaultValue={filters.view}
            options={optionsFrom(EVENT_VIEW_FILTERS)}
            className="col-span-2 md:col-span-1"
          />
          <NativeSelect
            name="trigger"
            aria-label="Trigger"
            defaultValue={filters.trigger ?? ''}
            placeholder="Any trigger"
            options={optionsFrom(TRIGGER_LABELS)}
          />
          <NativeSelect
            name="minRisk"
            aria-label="Minimum risk"
            defaultValue={filters.minRisk?.toString() ?? ''}
            placeholder="Any risk"
            options={optionsFrom(MIN_RISK_FILTERS)}
          />
          <div className="col-span-2 flex gap-2 md:col-span-1">
            <Button type="submit" variant="secondary" className="flex-1 md:flex-none">
              Apply
            </Button>
            {filtered ? (
              <Link href={SECURITY_TAB_HREF} className={buttonStyles({ variant: 'ghost' })}>
                Reset
              </Link>
            ) : null}
          </div>
        </Toolbar>
        {filters.invalid ? (
          <Callout tone="warning" className="mt-3">
            A filter was not understood and was ignored.
          </Callout>
        ) : null}
      </form>

      {page.items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={
            filters.view === 'review' && !filtered ? 'NOTHING TO REVIEW' : 'NO MATCHING EVENTS'
          }
          description={
            filters.view === 'review' && !filtered
              ? 'Automod detections, join screening and member reports land here for triage.'
              : 'No security event matches these filters.'
          }
          action={
            filtered ? (
              <Link href={SECURITY_TAB_HREF} className={buttonStyles({ variant: 'secondary' })}>
                Clear filters
              </Link>
            ) : (
              <Link
                href={`${SECURITY_TAB_HREF}&view=all`}
                className={buttonStyles({ variant: 'secondary' })}
              >
                View all events
              </Link>
            )
          }
        />
      ) : (
        <EventList events={page.items} thresholds={thresholds} timeZone={timeZone} />
      )}

      {page.total > 0 ? (
        <div className="border-t border-line-subtle px-5 py-3">
          <Pagination
            offset={page.offset}
            limit={page.limit}
            total={page.total}
            linkComponent={NextLink}
            label="Security events pagination"
            hrefForOffset={(next) =>
              `/moderation${toQueryString({ ...query, offset: next || undefined })}`
            }
          />
        </div>
      ) : null}
    </Card>
  );
}
