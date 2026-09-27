import type { Metadata } from 'next';
import { DOMAIN_EVENTS, integrations } from '@jave/core';
import { Callout, LinkTabs, Mono, PageHeader } from '@jave/ui';
import { CreateIntegrationDialog } from '@/components/integrations/integration-controls';
import { CreateOutboundDialog } from '@/components/integrations/outbound-controls';
import { NextLink } from '@/components/next-link';
import { RestrictedPage } from '@/components/restricted-page';
import { groupEventTypes } from '@/lib/integration-view';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import { getRuntime } from '@/server/runtime';
import { createIntegrationAction, createOutboundAction } from './actions';
import {
  DeliveriesPanel,
  InboundPanel,
  INTEGRATION_TABS,
  type IntegrationTab,
  OutboundLogPanel,
  OutboundPanel,
} from './panels';

export const metadata: Metadata = { title: 'Integrations' };

const TAB_LABELS: Record<IntegrationTab, string> = {
  inbound: 'Inbound',
  deliveries: 'Deliveries',
  outbound: 'Outbound',
  'outbound-log': 'Outbound log',
};

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const loaded = await guarded(() => integrations.listIntegrations(ctx));
  if (!loaded.ok) {
    return (
      <RestrictedPage eyebrow="SYSTEM" title="Integrations" capability="canManageIntegrations" />
    );
  }
  const registry = loaded.value;
  const query = await searchParams;
  const requested = firstParam(query.tab) as IntegrationTab | undefined;
  const tab: IntegrationTab =
    requested && INTEGRATION_TABS.includes(requested) ? requested : 'inbound';
  const viewer = await loadViewer(ctx);
  const { env, coreConfig } = getRuntime();
  const eventGroups = groupEventTypes(
    integrations.EXTERNAL_EVENT_TYPES.map((type) => ({
      type,
      description: DOMAIN_EVENTS[type].description,
    })),
  );
  const panelProps = {
    ctx,
    registry,
    query,
    timeZone: viewer.timeZone,
    publicUrl: env.JAVE_PUBLIC_URL,
    eventGroups,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="SYSTEM"
        title="Integrations"
        description="Signed inbound webhooks and outbound event delivery. Integration data never becomes capability on its own."
        meta={
          <Mono dim>
            {registry.length} {registry.length === 1 ? 'integration' : 'integrations'}
          </Mono>
        }
        actions={
          tab === 'outbound' || tab === 'outbound-log' ? (
            <CreateOutboundDialog action={createOutboundAction} groups={eventGroups} />
          ) : (
            <CreateIntegrationDialog action={createIntegrationAction} />
          )
        }
      />

      {!coreConfig.encryptionKey ? (
        <Callout tone="warning" title="JAVE_ENCRYPTION_KEY NOT SET">
          Signed integrations and outbound webhooks cannot store secrets and are refused until the
          deployment sets a 32-byte key.
        </Callout>
      ) : null}
      {!env.GITHUB_WEBHOOK_SECRET ? (
        <Callout tone="neutral" title="GITHUB_WEBHOOK_SECRET NOT SET">
          GitHub deliveries answer 503 until the deployment sets the webhook secret.
        </Callout>
      ) : null}

      <LinkTabs
        label="Integration sections"
        linkComponent={NextLink}
        tabs={INTEGRATION_TABS.map((key) => ({
          href: key === 'inbound' ? '/integrations' : `/integrations?tab=${key}`,
          label: TAB_LABELS[key],
          active: key === tab,
        }))}
      />

      {tab === 'inbound' ? <InboundPanel {...panelProps} /> : null}
      {tab === 'deliveries' ? <DeliveriesPanel {...panelProps} /> : null}
      {tab === 'outbound' ? <OutboundPanel {...panelProps} /> : null}
      {tab === 'outbound-log' ? <OutboundLogPanel {...panelProps} /> : null}
    </div>
  );
}
