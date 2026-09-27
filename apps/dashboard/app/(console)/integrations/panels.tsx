import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Send, Webhook } from 'lucide-react';
import { integrations, isUuid, NotFoundError } from '@jave/core';
import {
  Badge,
  Button,
  buttonStyles,
  Callout,
  Card,
  EmptyState,
  Icon,
  Mono,
  NativeSelect,
  Pagination,
  Panel,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeaderCell,
  TableRow,
  Toolbar,
} from '@jave/ui';
import { CopyField } from '@/components/integrations/copy-field';
import { IntegrationRowControls } from '@/components/integrations/integration-controls';
import { OutboundRowControls } from '@/components/integrations/outbound-controls';
import { NextLink } from '@/components/next-link';
import { InlineAction } from '@/components/projects/inline-action';
import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONE,
  type DeliveryStatusKey,
  eventCountLabel,
  type EventTypeGroup,
  payloadPreview,
  PROVIDER_LABELS,
  RETRYABLE_DELIVERY_STATUSES,
  webhookEndpoint,
} from '@/lib/integration-view';
import { optionsFrom } from '@/lib/member-labels';
import { firstParam, offsetParam, type SearchParams, toQueryString } from '@/lib/search-params';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import {
  deleteOutboundAction,
  retryDeliveryAction,
  rotateIntegrationSecretAction,
  rotateOutboundSecretAction,
  setIntegrationEnabledAction,
  setOutboundEnabledAction,
  updateIntegrationAction,
  updateOutboundAction,
} from './actions';

export const INTEGRATION_TABS = ['inbound', 'deliveries', 'outbound', 'outbound-log'] as const;
export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

const PAGE_SIZE = 25;
/** Event badges shown per subscription row before "+N". */
const EVENT_BADGES_SHOWN = 4;
const DELIVERY_STATUSES = Object.keys(DELIVERY_STATUS_LABELS) as DeliveryStatusKey[];

export interface PanelProps {
  ctx: UserContext;
  registry: readonly integrations.IntegrationView[];
  query: SearchParams;
  timeZone: string;
  publicUrl: string;
  eventGroups: readonly EventTypeGroup[];
}

function statusFilter(query: SearchParams): DeliveryStatusKey | undefined {
  const value = firstParam(query.status);
  return DELIVERY_STATUSES.find((status) => status === value);
}

function uuidParam(query: SearchParams, name: string): string | undefined {
  const value = firstParam(query[name]);
  return value && isUuid(value) ? value : undefined;
}

function DeliveryStatus({ status }: { status: DeliveryStatusKey }) {
  return (
    <StatusBadge
      tone={DELIVERY_STATUS_TONE[status]}
      quiet={status === 'processed' || status === 'ignored'}
      label={DELIVERY_STATUS_LABELS[status].toUpperCase()}
    />
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 truncate text-small text-fg-muted">{children}</dd>
    </div>
  );
}

// ─── Inbound registry ────────────────────────────────────────────────────────

export function InboundPanel({ registry, timeZone, publicUrl }: PanelProps) {
  if (registry.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={Webhook}
          title="NO INTEGRATIONS"
          description="Register a sender to get a signed endpoint. Nothing is accepted until an integration exists."
        />
      </Card>
    );
  }
  return (
    <ul aria-label="Integrations" className="space-y-3">
      {registry.map((integration) => {
        const relay = integrations.relayChannelOf(integration.config);
        return (
          <li key={integration.id} data-integration={integration.slug}>
            <Card padding="none">
              <div className="flex flex-col gap-4 border-b border-line-subtle px-5 py-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="type-heading text-fg">{integration.name}</h2>
                    <Badge>{PROVIDER_LABELS[integration.provider]}</Badge>
                    <StatusBadge
                      tone={integration.enabled ? 'success' : 'neutral'}
                      quiet={integration.enabled}
                      label={integration.enabled ? 'ENABLED' : 'DISABLED'}
                    />
                  </div>
                  <p className="text-small text-fg-subtle">
                    {integration.secretSource === 'environment'
                      ? 'Verified with the deployment secret GITHUB_WEBHOOK_SECRET.'
                      : integration.hasSecret
                        ? `JAVE v1 signature. Secret issued ${integration.secretRotatedAt ? formatTimestamp(integration.secretRotatedAt, timeZone) : '—'}.`
                        : 'No signing secret stored. Rotate to issue one.'}
                  </p>
                </div>
                <IntegrationRowControls
                  integrationId={integration.id}
                  name={integration.name}
                  enabled={integration.enabled}
                  rotatable={integration.secretSource === 'generated'}
                  relayChannelId={relay}
                  actions={{
                    update: updateIntegrationAction,
                    rotate: rotateIntegrationSecretAction,
                    setEnabled: setIntegrationEnabledAction,
                  }}
                />
              </div>
              <div className="space-y-4 px-5 py-4">
                <CopyField
                  value={webhookEndpoint(publicUrl, integration.webhookPath)}
                  label="Endpoint URL"
                  className="max-w-2xl"
                />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                  <Meta label="LAST EVENT">
                    <Mono>
                      {integration.lastEventAt
                        ? formatTimestamp(integration.lastEventAt, timeZone)
                        : '—'}
                    </Mono>
                  </Meta>
                  <Meta label="DISCORD RELAY">
                    <Mono>{relay ?? '—'}</Mono>
                  </Meta>
                  <Meta label="CREATED">
                    <Mono>{formatTimestamp(integration.createdAt, timeZone)}</Mono>
                  </Meta>
                  <Meta label="DELIVERIES">
                    <Link
                      href={`/integrations?tab=deliveries&integration=${integration.id}`}
                      className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                    >
                      View log <Icon icon={ArrowRight} size="sm" />
                    </Link>
                  </Meta>
                </dl>
                {integration.lastError ? (
                  <p className="text-small text-danger">
                    <span className="type-eyebrow mr-2">LAST ERROR</span>
                    {integration.lastErrorAt ? (
                      <Mono dim className="mr-2">
                        {formatTimestamp(integration.lastErrorAt, timeZone)}
                      </Mono>
                    ) : null}
                    {integration.lastError}
                  </p>
                ) : null}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Inbound delivery log ────────────────────────────────────────────────────

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
  const status = statusFilter(query);
  const deliveryId = uuidParam(query, 'delivery');
  const offset = offsetParam(query.offset);
  const page = await integrations.listWebhookDeliveries(ctx, {
    integrationId,
    status,
    limit: PAGE_SIZE,
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
        <form
          method="get"
          action="/integrations"
          aria-label="Filter deliveries"
          className="border-b border-line-subtle p-4"
        >
          <input type="hidden" name="tab" value="deliveries" />
          <Toolbar className="grid grid-cols-2 gap-2.5 sm:flex">
            <NativeSelect
              name="integration"
              aria-label="Integration"
              defaultValue={integrationId ?? ''}
              placeholder="All integrations"
              options={registry.map((integration) => ({
                value: integration.id,
                label: integration.name,
              }))}
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
                <Link
                  href="/integrations?tab=deliveries"
                  className={buttonStyles({ variant: 'ghost' })}
                >
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>
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
      {page.total > PAGE_SIZE ? (
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

// ─── Outbound subscriptions ──────────────────────────────────────────────────

export async function OutboundPanel({ ctx, timeZone, eventGroups }: PanelProps) {
  const webhooks = await integrations.listOutboundWebhooks(ctx);
  if (webhooks.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={Send}
          title="NO OUTBOUND WEBHOOKS"
          description="Subscribe an external service to JAVE events. Deliveries are signed, retried with backoff and never follow redirects."
        />
      </Card>
    );
  }
  return (
    <ul aria-label="Outbound webhooks" className="space-y-3">
      {webhooks.map((webhook) => (
        <li key={webhook.id} data-webhook={webhook.name}>
          <Card padding="none">
            <div className="flex flex-col gap-4 border-b border-line-subtle px-5 py-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="type-heading text-fg">{webhook.name}</h2>
                  <StatusBadge
                    tone={webhook.enabled ? 'success' : webhook.disabledAt ? 'danger' : 'neutral'}
                    quiet={webhook.enabled}
                    label={
                      webhook.enabled
                        ? 'ENABLED'
                        : webhook.disabledAt
                          ? 'AUTO-DISABLED'
                          : 'DISABLED'
                    }
                  />
                </div>
                <Mono dim className="block truncate">
                  {webhook.displayUrl}
                </Mono>
              </div>
              <OutboundRowControls
                webhookId={webhook.id}
                name={webhook.name}
                displayUrl={webhook.displayUrl}
                enabled={webhook.enabled}
                eventTypes={webhook.eventTypes}
                groups={eventGroups}
                actions={{
                  update: updateOutboundAction,
                  setEnabled: setOutboundEnabledAction,
                  rotate: rotateOutboundSecretAction,
                  remove: deleteOutboundAction,
                }}
              />
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="type-eyebrow mr-1 text-fg-subtle">
                  {eventCountLabel(webhook.eventTypes.length)}
                </span>
                {webhook.eventTypes.slice(0, EVENT_BADGES_SHOWN).map((type) => (
                  <Badge key={type} className="normal-case">
                    {type}
                  </Badge>
                ))}
                {webhook.eventTypes.length > EVENT_BADGES_SHOWN ? (
                  <Mono dim className="text-[12px]">
                    +{webhook.eventTypes.length - EVENT_BADGES_SHOWN}
                  </Mono>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
                <Meta label="LAST DELIVERY">
                  <Mono>
                    {webhook.lastDeliveryAt
                      ? formatTimestamp(webhook.lastDeliveryAt, timeZone)
                      : '—'}
                  </Mono>
                </Meta>
                <Meta label="FAILURE STREAK">
                  <Mono>{webhook.consecutiveFailures}</Mono>
                </Meta>
                <Meta label="SECRET ISSUED">
                  <Mono>
                    {webhook.secretRotatedAt
                      ? formatTimestamp(webhook.secretRotatedAt, timeZone)
                      : '—'}
                  </Mono>
                </Meta>
                <Meta label="DELIVERIES">
                  <Link
                    href={`/integrations?tab=outbound-log&webhook=${webhook.id}`}
                    className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                  >
                    View log <Icon icon={ArrowRight} size="sm" />
                  </Link>
                </Meta>
              </dl>
              {webhook.disabledReason ? (
                <p className="text-small text-danger">
                  <span className="type-eyebrow mr-2">DISABLED</span>
                  {webhook.disabledReason}
                </p>
              ) : null}
              {webhook.lastError ? (
                <p className="break-words text-small text-fg-muted">
                  <span className="type-eyebrow mr-2 text-fg-subtle">LAST ERROR</span>
                  {webhook.lastError}
                </p>
              ) : null}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ─── Outbound delivery log ───────────────────────────────────────────────────

export async function OutboundLogPanel({ ctx, query, timeZone }: PanelProps) {
  const webhookId = uuidParam(query, 'webhook');
  const status = statusFilter(query);
  const offset = offsetParam(query.offset);
  const [page, webhooks] = await Promise.all([
    integrations.listOutboundDeliveries(ctx, { webhookId, status, limit: PAGE_SIZE, offset }),
    integrations.listOutboundWebhooks(ctx),
  ]);
  const names = new Map(webhooks.map((webhook) => [webhook.id, webhook.name]));
  const filtered = Boolean(webhookId || status);
  return (
    <div className="space-y-6">
      <Card padding="none">
        <form
          method="get"
          action="/integrations"
          aria-label="Filter outbound deliveries"
          className="border-b border-line-subtle p-4"
        >
          <input type="hidden" name="tab" value="outbound-log" />
          <Toolbar className="grid grid-cols-2 gap-2.5 sm:flex">
            <NativeSelect
              name="webhook"
              aria-label="Webhook"
              defaultValue={webhookId ?? ''}
              placeholder="All webhooks"
              options={webhooks.map((webhook) => ({ value: webhook.id, label: webhook.name }))}
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
                <Link
                  href="/integrations?tab=outbound-log"
                  className={buttonStyles({ variant: 'ghost' })}
                >
                  Reset
                </Link>
              ) : null}
            </div>
          </Toolbar>
        </form>
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
      {page.total > PAGE_SIZE ? (
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
