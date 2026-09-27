import { integrations } from '@jave/core';
import {
  Card,
  Mono,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@jave/ui';
import { NextLink } from '@/components/next-link';
import { offsetParam, toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import {
  DeliveryStatus,
  LOG_PAGE_SIZE,
  LogFilterForm,
  type PanelProps,
  statusParam,
  uuidParam,
} from './panel-parts';

/** Outbound delivery log: HTTP status, attempts and the last error per delivery. */
export async function OutboundLogPanel({ ctx, webhooks, query, timeZone }: PanelProps) {
  const webhookId = uuidParam(query, 'webhook');
  const status = statusParam(query);
  const offset = offsetParam(query.offset);
  const page = await integrations.listOutboundDeliveries(ctx, {
    webhookId,
    status,
    limit: LOG_PAGE_SIZE,
    offset,
  });
  const names = new Map(webhooks.map((webhook) => [webhook.id, webhook.name]));
  const filtered = Boolean(webhookId || status);
  return (
    <div className="space-y-6">
      <Card padding="none">
        <LogFilterForm
          tab="outbound-log"
          label="Filter outbound deliveries"
          source={{
            name: 'webhook',
            label: 'Webhook',
            placeholder: 'All webhooks',
            value: webhookId,
            options: webhooks.map((webhook) => ({ value: webhook.id, label: webhook.name })),
          }}
          status={status}
        />
        <Table caption="Outbound deliveries" dense>
          <TableHead>
            <tr>
              <TableHeaderCell>Event</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell text-right">HTTP</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell text-right">
                Attempts
              </TableHeaderCell>
              <TableHeaderCell className="hidden lg:table-cell">Error</TableHeaderCell>
              <TableHeaderCell className="hidden sm:table-cell text-right">Queued</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {page.items.length === 0 ? (
              <TableEmptyRow
                colSpan={6}
                title={filtered ? 'NO MATCHES' : 'NO DELIVERIES YET'}
                description={
                  filtered
                    ? 'No delivery matches these filters.'
                    : 'Events sent to subscribed webhooks appear here.'
                }
              />
            ) : (
              page.items.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <span className="block truncate font-mono text-small text-fg">
                      {delivery.eventType}
                    </span>
                    <span className="block truncate text-small text-fg-subtle">
                      {names.get(delivery.webhookId) ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DeliveryStatus status={delivery.status} />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Mono>{delivery.responseStatus ?? '—'}</Mono>
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <Mono>{delivery.attempts}</Mono>
                  </TableCell>
                  <TableCell className="hidden max-w-72 lg:table-cell">
                    <span className="line-clamp-1 text-small text-fg-subtle">
                      {delivery.lastError ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    <Mono dim>{formatTimestamp(delivery.createdAt, timeZone)}</Mono>
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
          hrefForOffset={(next) =>
            `/integrations${toQueryString({ tab: 'outbound-log', webhook: webhookId, status, offset: next || undefined })}`
          }
        />
      ) : null}
    </div>
  );
}
