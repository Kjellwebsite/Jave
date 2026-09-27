import Link from 'next/link';
import type { ReactNode } from 'react';
import { isUuid, type integrations } from '@jave/core';
import { Button, buttonStyles, NativeSelect, StatusBadge, Toolbar } from '@jave/ui';
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  type DeliveryStatusKey,
  type EventTypeGroup,
} from '@/lib/integration-view';
import { optionsFrom } from '@/lib/member-labels';
import { firstParam, type SearchParams } from '@/lib/search-params';
import type { UserContext } from '@/server/context';

/** Shared pieces of the /integrations tab panels (server components). */

export const INTEGRATION_TABS = ['inbound', 'deliveries', 'outbound', 'outbound-log'] as const;
export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

/** Rows per delivery-log page. */
export const LOG_PAGE_SIZE = 25;

const DELIVERY_STATUSES = Object.keys(DELIVERY_STATUS_LABELS) as DeliveryStatusKey[];

export interface PanelProps {
  ctx: UserContext;
  registry: readonly integrations.IntegrationView[];
  query: SearchParams;
  timeZone: string;
  publicUrl: string;
  eventGroups: readonly EventTypeGroup[];
}

/** The tab from the query string; anything unknown is the registry. */
export function integrationTab(query: SearchParams): IntegrationTab {
  const requested = firstParam(query.tab);
  return INTEGRATION_TABS.find((tab) => tab === requested) ?? 'inbound';
}

export function statusParam(query: SearchParams): DeliveryStatusKey | undefined {
  const value = firstParam(query.status);
  return DELIVERY_STATUSES.find((status) => status === value);
}

/** A uuid query parameter; anything else is ignored rather than sent to core. */
export function uuidParam(query: SearchParams, name: string): string | undefined {
  const value = firstParam(query[name]);
  return value && isUuid(value) ? value : undefined;
}

export function DeliveryStatus({ status }: { status: DeliveryStatusKey }) {
  return (
    <StatusBadge
      tone={DELIVERY_STATUS_TONE[status]}
      quiet={status === 'processed' || status === 'ignored'}
      label={DELIVERY_STATUS_LABELS[status].toUpperCase()}
    />
  );
}

export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 truncate text-small text-fg-muted">{children}</dd>
    </div>
  );
}

export interface LogFilterFormProps {
  tab: Extract<IntegrationTab, 'deliveries' | 'outbound-log'>;
  label: string;
  /** Query parameter and options of the source filter (integration or webhook). */
  source: {
    name: string;
    label: string;
    placeholder: string;
    value: string | undefined;
    options: { value: string; label: string }[];
  };
  status: DeliveryStatusKey | undefined;
}

/** GET filter bar for a delivery log: source + status, with a reset when filtered. */
export function LogFilterForm({ tab, label, source, status }: LogFilterFormProps) {
  const filtered = Boolean(source.value || status);
  return (
    <form
      method="get"
      action="/integrations"
      aria-label={label}
      className="border-b border-line-subtle p-4"
    >
      <input type="hidden" name="tab" value={tab} />
      <Toolbar className="grid grid-cols-2 gap-2.5 sm:flex">
        <NativeSelect
          name={source.name}
          aria-label={source.label}
          defaultValue={source.value ?? ''}
          placeholder={source.placeholder}
          options={source.options}
          className="sm:w-56"
        />
        <NativeSelect
          name="status"
          aria-label="Status"
          defaultValue={status ?? ''}
          placeholder="Any status"
          options={optionsFrom(DELIVERY_STATUS_LABELS)}
          className="sm:w-44"
        />
        <div className="col-span-2 flex gap-2">
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          {filtered ? (
            <Link href={`/integrations?tab=${tab}`} className={buttonStyles({ variant: 'ghost' })}>
              Reset
            </Link>
          ) : null}
        </div>
      </Toolbar>
    </form>
  );
}
