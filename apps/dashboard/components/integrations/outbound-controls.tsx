'use client';

import { useId } from 'react';
import { Plus, RotateCw } from 'lucide-react';
import { Button, Checkbox, Fieldset, Input } from '@jave/ui';
import { type EventTypeGroup } from '@/lib/integration-view';
import type { FormAction } from '../forms/action-form';
import { useActionFieldError } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';
import { InlineAction } from '../projects/inline-action';
import { type SecretAction, SecretDialog } from './secret-dialog';

const NAME_MIN = 2;
const NAME_MAX = 80;
const URL_MAX = 2048;

/** Catalog events grouped by family; only `external: true` events are offered. */
function EventTypePicker({
  groups,
  selected,
}: {
  groups: readonly EventTypeGroup[];
  selected: readonly string[];
}) {
  const baseId = useId();
  const error = useActionFieldError('eventTypes');
  return (
    <Fieldset
      legend="Events"
      description="Only external catalog events are offered. Project and contribution events leave JAVE only for public projects."
    >
      <div className="max-h-72 space-y-4 overflow-y-auto rounded-md border border-line bg-surface-sunken p-3">
        {groups.map((group) => (
          <div key={group.family} className="space-y-2">
            <p className="type-eyebrow text-fg-subtle">{group.family}</p>
            {group.events.map((event) => (
              <Checkbox
                key={event.type}
                id={`${baseId}-${event.type}`}
                name="eventTypes"
                value={event.type}
                defaultChecked={selected.includes(event.type)}
                label={<span className="font-mono text-small">{event.type}</span>}
                description={event.description}
              />
            ))}
          </div>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </Fieldset>
  );
}

export function CreateOutboundDialog({
  action,
  groups,
}: {
  action: SecretAction;
  groups: readonly EventTypeGroup[];
}) {
  return (
    <SecretDialog
      eyebrow="OUTBOUND"
      title="Add webhook"
      description="JAVE POSTs signed JSON to this URL for each selected event. https only; private and local addresses are refused."
      confirmLabel="Create webhook"
      action={action}
      secretHint="Verify X-Jave-Signature with this secret on the receiver. JAVE stores it encrypted and cannot show it again."
      trigger={
        <Button variant="primary" iconLeft={Plus} data-testid="add-webhook">
          Add webhook
        </Button>
      }
    >
      <FormField name="name" label="Name" required>
        <Input
          name="name"
          required
          minLength={NAME_MIN}
          maxLength={NAME_MAX}
          placeholder="Analytics sink"
        />
      </FormField>
      <FormField
        name="url"
        label="URL"
        description="Shown masked after creation: webhook URLs often embed credentials."
        required
      >
        <Input
          name="url"
          type="url"
          inputMode="url"
          required
          maxLength={URL_MAX}
          placeholder="https://"
          mono
          autoComplete="off"
        />
      </FormField>
      <EventTypePicker groups={groups} selected={[]} />
    </SecretDialog>
  );
}

export interface OutboundRowControlsProps {
  webhookId: string;
  name: string;
  displayUrl: string;
  enabled: boolean;
  eventTypes: readonly string[];
  groups: readonly EventTypeGroup[];
  actions: {
    update: FormAction;
    setEnabled: FormAction;
    rotate: SecretAction;
    remove: FormAction;
  };
}

export function OutboundRowControls({
  webhookId,
  name,
  displayUrl,
  enabled,
  eventTypes,
  groups,
  actions,
}: OutboundRowControlsProps) {
  return (
    <div className="flex flex-wrap items-start justify-end gap-1">
      <ConfirmActionDialog
        eyebrow="OUTBOUND"
        title={`Edit ${name}`}
        description="Change the name, events or target. Leave the URL empty to keep the current one."
        confirmLabel="Save webhook"
        action={actions.update}
        hidden={{ webhookId }}
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
        <FormField name="url" label="New URL" description={`Current: ${displayUrl}`}>
          <Input
            name="url"
            type="url"
            inputMode="url"
            maxLength={URL_MAX}
            placeholder="Keep current"
            mono
            autoComplete="off"
          />
        </FormField>
        <EventTypePicker groups={groups} selected={eventTypes} />
      </ConfirmActionDialog>
      <SecretDialog
        eyebrow="OUTBOUND"
        title={`Rotate secret — ${name}`}
        description="Issues a new signing secret. Deliveries are signed with it from now on."
        confirmLabel="Rotate secret"
        tone="danger"
        action={actions.rotate}
        hidden={{ webhookId }}
        secretHint="Update the receiver now: signatures made with the old secret stop matching."
        trigger={
          <Button size="sm" variant="ghost" iconLeft={RotateCw}>
            Rotate
          </Button>
        }
      />
      {enabled ? (
        <ConfirmActionDialog
          eyebrow="OUTBOUND"
          title={`Disable ${name}`}
          description="No new deliveries are queued until you enable it again."
          confirmLabel="Disable webhook"
          action={actions.setEnabled}
          hidden={{ webhookId, enabled: 'false' }}
          trigger={
            <Button size="sm" variant="ghost">
              Disable
            </Button>
          }
        />
      ) : (
        <InlineAction
          action={actions.setEnabled}
          hidden={{ webhookId, enabled: 'true' }}
          label="Enable"
          variant="secondary"
        />
      )}
      <ConfirmActionDialog
        eyebrow="OUTBOUND"
        title={`Delete ${name}`}
        description="The subscription and its delivery log are deleted. Queued deliveries are skipped."
        confirmLabel="Delete webhook"
        tone="danger"
        action={actions.remove}
        hidden={{ webhookId }}
        trigger={
          <Button size="sm" variant="ghost">
            Delete
          </Button>
        }
      />
    </div>
  );
}
