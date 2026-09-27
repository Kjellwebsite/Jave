'use client';

import { Plus, RotateCw } from 'lucide-react';
import { Button, Input, NativeSelect } from '@jave/ui';
import { PROVIDER_HINTS, PROVIDER_LABELS, type ProviderKey } from '@/lib/integration-view';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { InlineAction } from '../forms/inline-action';
import { type SecretAction, SecretDialog } from './secret-dialog';

const NAME_MIN = 2;
const NAME_MAX = 80;
const SLUG_MIN = 3;
const SLUG_MAX = 48;
const SNOWFLAKE_PATTERN = '\\d{17,20}';
const SLUG_INPUT_PATTERN = '[a-z0-9][a-z0-9\\-]{1,46}[a-z0-9]';

const PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderKey[];

function RelayChannelField({ defaultValue }: { defaultValue?: string }) {
  return (
    <FormField
      name="relayChannelId"
      label="Discord relay channel"
      description="Optional, generic integrations only. Channel ID; the bot posts a sanitized summary of each delivery. Needs View Channel, Send Messages and Embed Links."
    >
      <Input
        name="relayChannelId"
        defaultValue={defaultValue ?? ''}
        inputMode="numeric"
        pattern={SNOWFLAKE_PATTERN}
        maxLength={20}
        placeholder="Channel ID"
        mono
        autoComplete="off"
      />
    </FormField>
  );
}

export function CreateIntegrationDialog({ action }: { action: SecretAction }) {
  return (
    <SecretDialog
      eyebrow="INBOUND"
      title="Add integration"
      description="Registers a signed endpoint at /api/webhooks/{slug}. JAVE-signed providers receive a signing secret, shown once."
      confirmLabel="Create integration"
      action={action}
      secretHint="Configure the sender with this secret now. JAVE stores it encrypted and cannot show it again; rotate to issue a new one."
      trigger={
        <Button variant="primary" iconLeft={Plus} data-testid="add-integration">
          Add integration
        </Button>
      }
    >
      <FormField name="provider" label="Provider" required>
        <NativeSelect
          name="provider"
          defaultValue="generic"
          options={PROVIDERS.map((provider) => ({
            value: provider,
            label: `${PROVIDER_LABELS[provider]} — ${PROVIDER_HINTS[provider]}`,
          }))}
        />
      </FormField>
      <FormField name="name" label="Name" required>
        <Input
          name="name"
          required
          minLength={NAME_MIN}
          maxLength={NAME_MAX}
          placeholder="CI pipeline"
        />
      </FormField>
      <FormField
        name="slug"
        label="Slug"
        description="Endpoint path. 3–48 lowercase letters, digits and hyphens. Use github for the GitHub endpoint."
        required
      >
        <Input
          name="slug"
          required
          minLength={SLUG_MIN}
          maxLength={SLUG_MAX}
          pattern={SLUG_INPUT_PATTERN}
          placeholder="ci-hooks"
          mono
          autoComplete="off"
        />
      </FormField>
      <RelayChannelField />
    </SecretDialog>
  );
}

export interface IntegrationRowControlsProps {
  integrationId: string;
  name: string;
  enabled: boolean;
  /** JAVE-signed providers can rotate; GitHub uses the deployment secret. */
  rotatable: boolean;
  relayChannelId: string | null;
  actions: {
    update: FormAction;
    rotate: SecretAction;
    setEnabled: FormAction;
  };
}

export function IntegrationRowControls({
  integrationId,
  name,
  enabled,
  rotatable,
  relayChannelId,
  actions,
}: IntegrationRowControlsProps) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-1">
      <ConfirmActionDialog
        eyebrow="INBOUND"
        title={`Edit ${name}`}
        description="Name and non-secret configuration. The slug and provider are fixed."
        confirmLabel="Save integration"
        action={actions.update}
        hidden={{ integrationId }}
        trigger={
          <Button size="sm" variant="ghost">
            Edit
          </Button>
        }
      >
        <FormField name="name" label="Name" required>
          <Input
            name="name"
            required
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            defaultValue={name}
          />
        </FormField>
        <RelayChannelField defaultValue={relayChannelId ?? undefined} />
      </ConfirmActionDialog>
      {rotatable ? (
        <SecretDialog
          eyebrow="INBOUND"
          title={`Rotate secret — ${name}`}
          description="Issues a new signing secret. The current one stops verifying immediately: deliveries fail until the sender is updated."
          confirmLabel="Rotate secret"
          tone="danger"
          action={actions.rotate}
          hidden={{ integrationId }}
          secretHint="Update the sender with this secret now. Requests signed with the old secret are refused."
          trigger={
            <Button size="sm" variant="ghost" iconLeft={RotateCw}>
              Rotate
            </Button>
          }
        />
      ) : null}
      {enabled ? (
        <ConfirmActionDialog
          eyebrow="INBOUND"
          title={`Disable ${name}`}
          description="Its endpoint answers 404 until you enable it again. Senders may retry and give up."
          confirmLabel="Disable integration"
          tone="danger"
          action={actions.setEnabled}
          hidden={{ integrationId, enabled: 'false' }}
          trigger={
            <Button size="sm" variant="ghost">
              Disable
            </Button>
          }
        />
      ) : (
        <InlineAction
          action={actions.setEnabled}
          hidden={{ integrationId, enabled: 'true' }}
          label="Enable"
          variant="secondary"
        />
      )}
    </div>
  );
}
