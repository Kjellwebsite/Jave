import Link from 'next/link';
import { ArrowRight, Send } from 'lucide-react';
import { Badge, Card, EmptyState, Icon, Mono, StatusBadge } from '@jave/ui';
import { OutboundRowControls } from '@/components/integrations/outbound-controls';
import { eventCountLabel } from '@/lib/integration-view';
import { formatTimestamp } from '@/lib/time';
import {
  deleteOutboundAction,
  rotateOutboundSecretAction,
  setOutboundEnabledAction,
  updateOutboundAction,
} from './actions';
import { Meta, type PanelProps } from './panel-parts';

/** Event badges shown per subscription row before "+N". */
const EVENT_BADGES_SHOWN = 4;

/** Outbound subscriptions: masked target, events, health and controls. */
export function OutboundPanel({ webhooks, timeZone, eventGroups }: PanelProps) {
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
