import Link from 'next/link';
import { ArrowRight, Webhook } from 'lucide-react';
import { integrations } from '@jave/core';
import { Badge, Card, EmptyState, Icon, Mono, StatusBadge } from '@jave/ui';
import { CopyField } from '@/components/integrations/copy-field';
import { IntegrationRowControls } from '@/components/integrations/integration-controls';
import { PROVIDER_LABELS, webhookEndpoint } from '@/lib/integration-view';
import { formatTimestamp } from '@/lib/time';
import {
  rotateIntegrationSecretAction,
  setIntegrationEnabledAction,
  updateIntegrationAction,
} from './actions';
import { Meta, type PanelProps } from './panel-parts';

/** The inbound registry: one card per integration with its endpoint and controls. */
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
