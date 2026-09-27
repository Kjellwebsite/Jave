import Link from 'next/link';
import { integrations, NotFoundError } from '@jave/core';
import {
  Callout,
  Card,
  Mono,
  Pagination,
  Panel,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { InlineAction } from '@/components/projects/inline-action';
import { payloadPreview, RETRYABLE_DELIVERY_STATUSES } from '@/lib/integration-view';
import { offsetParam, toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import { retryDeliveryAction } from './actions';
import {
  DeliveryStatus,
  LOG_PAGE_SIZE,
  LogFilterForm,
  Meta,
  type PanelProps,
  statusParam,
  uuidParam,
} from './panel-parts';

/** The inbound delivery log, with one delivery opened (payload collapsed, rendered as text). */
async function DeliveryDetail({
  ctx,
  deliveryId,
  timeZone,
  names,
}: {
  ctx: UserContext;
  deliveryId: string;
  timeZone: string;
  names: Map<string, string>;
}) {
  let delivery: integrations.WebhookDeliveryRecord;
  try {
    delivery = await integrations.getWebhookDelivery(ctx, { deliveryId });
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return (
      <Callout tone="neutral" title="DELIVERY NOT FOUND">
        It may have been removed, or the link is stale.
      </Callout>
    );
  }
  const preview = payloadPreview(delivery.payload);
  const retryable = RETRYABLE_DELIVERY_STATUSES.includes(delivery.status);
  return (
    <Panel
      title={`${delivery.eventType} · ${names.get(delivery.integrationId) ?? 'Unknown integration'}`}
      eyebrow="DELIVERY"
      actions={
        retryable ? (
          <InlineAction
            action={retryDeliveryAction}
            hidden={{ deliveryId: delivery.id }}
            label="Retry delivery"
            variant="secondary"
            data-testid="retry-delivery"
          />
        ) : null
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Meta label="STATUS">
          <DeliveryStatus status={delivery.status} />
        </Meta>
        <Meta label="ATTEMPTS">
          <Mono>{delivery.attempts}</Mono>
        </Meta>
        <Meta label="RECEIVED">
          <Mono>{formatTimestamp(delivery.receivedAt, timeZone)}</Mono>
        </Meta>
        <Meta label="PROCESSED">
          <Mono>
            {delivery.processedAt ? formatTimestamp(delivery.processedAt, timeZone) : '—'}
          </Mono>
        </Meta>
        <Meta label="SENDER DELIVERY ID">
          <Mono className="select-all">{delivery.deliveryId}</Mono>
        </Meta>
        <Meta label="RELAYED">
          <Mono>{delivery.relayedAt ? formatTimestamp(delivery.relayedAt, timeZone) : '—'}</Mono>
        </Meta>
      </dl>
      {delivery.statusReason ? (
        <p className="mt-4 text-small text-fg-muted">
          <span className="type-eyebrow mr-2 text-fg-subtle">REASON</span>
          {delivery.statusReason}
        </p>
      ) : null}
      {delivery.lastError ? (
        <p className="mt-2 break-words text-small text-danger">
          <span className="type-eyebrow mr-2">ERROR</span>
          {delivery.lastError}
        </p>
      ) : null}
      <details className="group mt-5 rounded-md border border-line bg-surface-sunken">
        <summary className="type-eyebrow cursor-pointer select-none px-3 py-2.5 text-fg-muted hover:text-fg">
          Payload · {preview.length.toLocaleString('en-US')} characters
        </summary>
        <pre
          data-testid="delivery-payload"
          className="max-h-96 overflow-auto border-t border-line-subtle px-3 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-fg-muted"
        >
          {preview.text}
        </pre>
        {preview.truncated ? (
          <p className="border-t border-line-subtle px-3 py-2 text-small text-fg-subtle">
            Truncated for display. The full payload stays stored.
          </p>
        ) : null}
      </details>
    </Panel>
  );
}

export async function DeliveriesPanel({ ctx, registry, query, timeZone }: PanelProps) {
  const integrationId = uuidParam(query, 'integration');
  const status = statusParam(query);
  const deliveryId = uuidParam(query, 'delivery');
  const offset = offsetParam(query.offset);
  const page = await integrations.listWebhookDeliveries(ctx, {
    integrationId,
    status,
    limit: LOG_PAGE_SIZE,
    offset,
  });
  const names = new Map(registry.map((integration) => [integration.id, integration.name]));
  const base = { tab: 'deliveries', integration: integrationId, status };
  const href = (patch: Record<string, string | number | undefined>) =>
    `/integrations${toQueryString({ ...base, ...patch })}`;
  const filtered = Boolean(integrationId || status);

  return (
    <div className="space-y-6">
      {deliveryId ? (
        <DeliveryDetail ctx={ctx} deliveryId={deliveryId} timeZone={timeZone} names={names} />
      ) : null}
      <Card padding="none">
        <LogFilterForm
          tab="deliveries"
          label="Filter deliveries"
          source={{
            name: 'integration',
            label: 'Integration',
            placeholder: 'All integrations',
            value: integrationId,
            options: registry.map((integration) => ({
              value: integration.id,
              label: integration.name,
            })),
          }}
          status={status}
        />
        <Table caption="Inbound deliveries" dense>
          <TableHead>
            <tr>
              <TableHeaderCell>Event</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell text-right">
                Attempts
              </TableHeaderCell>
              <TableHeaderCell className="hidden lg:table-cell">Reason</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell text-right">
                Received
              </TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {page.items.length === 0 ? (
              <TableEmptyRow
                colSpan={5}
                title={filtered ? 'NO MATCHES' : 'NO DELIVERIES YET'}
                description={
                  filtered
                    ? 'No delivery matches these filters.'
                    : 'Signed requests to an integration endpoint appear here.'
                }
              />
            ) : (
              page.items.map((delivery) => (
                <TableRow
                  key={delivery.id}
                  className="relative"
                  data-delivery={delivery.deliveryId}
                  aria-selected={delivery.id === deliveryId || undefined}
                >
                  <TableCell>
                    <Link
                      href={href({ delivery: delivery.id, offset: offset || undefined })}
                      className="block min-w-0 after:absolute after:inset-0 focus-visible:outline-none"
                    >
                      <span className="block truncate font-mono text-small text-fg">
                        {delivery.eventType}
                      </span>
                      <span className="block truncate text-small text-fg-subtle">
                        {names.get(delivery.integrationId) ?? '—'}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DeliveryStatus status={delivery.status} />
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Mono>{delivery.attempts}</Mono>
                  </TableCell>
                  <TableCell className="hidden max-w-72 lg:table-cell">
                    <span
                      className={
                        delivery.lastError
                          ? 'line-clamp-1 text-small text-danger'
                          : 'line-clamp-1 text-small text-fg-subtle'
                      }
                    >
                      {delivery.lastError ?? delivery.statusReason ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Mono dim>{formatTimestamp(delivery.receivedAt, timeZone)}</Mono>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {page.total > LOG_PAGE_SIZE ? (
        <Pagination
          offset={page.offset}
          limit={page.limit}
          total={page.total}
          linkComponent={NextLink}
          hrefForOffset={(next) => href({ offset: next || undefined })}
        />
      ) : null}
    </div>
  );
}
