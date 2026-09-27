import { BookLock, Pencil, Plus, Trash2 } from 'lucide-react';
import { adversarial } from '@jave/core';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Mono,
  Panel,
  StatusBadge,
  Switch,
  Textarea,
} from '@jave/ui';
import type { FormAction } from '../../forms/action-form';
import { ConfirmActionDialog } from '../../forms/confirm-action-dialog';
import { FormField } from '../../forms/form-field';
import { SelectField } from '../../forms/select-field';
import { ActionButton } from '../action-button';

export interface ScenarioRow {
  id: string;
  key: string;
  title: string;
  technique: string;
  description: string;
  objective: string;
  guardrails: string;
  sandboxAssets: string;
  active: boolean;
}

export interface ScenarioLibraryProps {
  trialId: string;
  scenarios: readonly ScenarioRow[];
  techniques: readonly { value: string; label: string }[];
  standardGuardrails: string;
  actions: { create: FormAction; update: FormAction; remove: FormAction; seed: FormAction };
}

const { LIMITS, MIN_LENGTHS } = adversarial;

function ScenarioFields({
  scenario,
  techniques,
  standardGuardrails,
}: {
  scenario: ScenarioRow | null;
  techniques: ScenarioLibraryProps['techniques'];
  standardGuardrails: string;
}) {
  return (
    <>
      {scenario ? null : (
        <FormField
          name="key"
          label="Key"
          description="Permanent: 3–64 lowercase letters, digits, dashes."
          required
        >
          <Input name="key" required maxLength={LIMITS.scenarioKey} mono spellCheck={false} />
        </FormField>
      )}
      <FormField name="title" label="Title" required>
        <Input
          name="title"
          required
          minLength={MIN_LENGTHS.label}
          maxLength={LIMITS.title}
          defaultValue={scenario?.title}
        />
      </FormField>
      <SelectField
        name="technique"
        label="Technique"
        required
        defaultValue={scenario?.technique ?? techniques[0]?.value}
        options={techniques}
      />
      <FormField name="description" label="Description" required>
        <Textarea
          name="description"
          required
          minLength={MIN_LENGTHS.prose}
          maxLength={LIMITS.description}
          rows={3}
          defaultValue={scenario?.description}
        />
      </FormField>
      <FormField
        name="objective"
        label="Objective"
        description="What the operative attempts. Fictional assets only."
        required
      >
        <Textarea
          name="objective"
          required
          minLength={MIN_LENGTHS.prose}
          maxLength={LIMITS.objective}
          rows={3}
          defaultValue={scenario?.objective}
        />
      </FormField>
      <FormField
        name="guardrails"
        label="Guardrails"
        description="Must contain every standard prohibition, verbatim. Add, never remove."
        required
      >
        <Textarea
          name="guardrails"
          required
          minLength={MIN_LENGTHS.guardrails}
          maxLength={LIMITS.guardrails}
          rows={8}
          defaultValue={scenario?.guardrails ?? standardGuardrails}
        />
      </FormField>
      <FormField
        name="sandboxAssets"
        label="Sandbox assets"
        description="The fictional accounts, keys (JVLN-SANDBOX-…) and hosts (*.jvln.test) used."
        required
      >
        <Textarea
          name="sandboxAssets"
          required
          minLength={MIN_LENGTHS.prose}
          maxLength={LIMITS.sandboxAssets}
          rows={3}
          defaultValue={scenario?.sandboxAssets}
        />
      </FormField>
      {scenario ? (
        <>
          <input type="hidden" name="activeShown" value="1" />
          <Switch
            id={`scenario-active-${scenario.id}`}
            name="active"
            defaultChecked={scenario.active}
            label="Active"
            description="Inactive scenarios cannot be planned."
          />
        </>
      ) : null}
    </>
  );
}

/**
 * The scenario library (FICTIONAL DATA ONLY). Every text passes the safety
 * validator: no secrets, no links outside the sandbox domains, no personal
 * data, guardrails with every standard prohibition.
 */
export function ScenarioLibrary({
  trialId,
  scenarios,
  techniques,
  standardGuardrails,
  actions,
}: ScenarioLibraryProps) {
  const techniqueLabel = new Map(techniques.map((technique) => [technique.value, technique.label]));
  return (
    <Panel
      eyebrow="LIBRARY"
      title="Scenarios"
      description="Scripted, harmless tests of security culture. Fictional data, sandbox accounts and sandbox hosts only."
      flush
      actions={
        <span className="flex flex-wrap items-center gap-2">
          <ActionButton
            action={actions.seed}
            label="Install starters"
            icon="install"
            size="sm"
            hidden={{ trialId }}
          />
          <ConfirmActionDialog
            eyebrow="SCENARIO LIBRARY"
            title="New scenario"
            description="Checked by the safety validator on save. It rejects when in doubt — reword and retry."
            confirmLabel="Add scenario"
            action={actions.create}
            hidden={{ trialId }}
            trigger={
              <Button size="sm" iconLeft={Plus} data-testid="new-scenario">
                New scenario
              </Button>
            }
          >
            <ScenarioFields
              scenario={null}
              techniques={techniques}
              standardGuardrails={standardGuardrails}
            />
          </ConfirmActionDialog>
        </span>
      }
    >
      {scenarios.length === 0 ? (
        <EmptyState
          compact
          icon={BookLock}
          title="LIBRARY EMPTY"
          description="Install the five fictional starter scenarios, or write one."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {scenarios.map((scenario) => (
            <li
              key={scenario.id}
              data-scenario={scenario.key}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-small font-medium text-fg">{scenario.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-small text-fg-subtle">
                  <Mono dim className="text-[12px]">
                    {scenario.key}
                  </Mono>
                  <span>· {techniqueLabel.get(scenario.technique) ?? scenario.technique}</span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                <StatusBadge
                  tone={scenario.active ? 'success' : 'neutral'}
                  quiet={scenario.active}
                  label={scenario.active ? 'ACTIVE' : 'INACTIVE'}
                />
                <ConfirmActionDialog
                  eyebrow="SCENARIO LIBRARY"
                  title={`Edit ${scenario.title}`}
                  description="Roles already planned keep the snapshot they were authorized with."
                  confirmLabel="Save scenario"
                  action={actions.update}
                  hidden={{ trialId, scenarioId: scenario.id }}
                  trigger={<IconButton icon={Pencil} size="sm" label={`Edit ${scenario.title}`} />}
                >
                  <ScenarioFields
                    scenario={scenario}
                    techniques={techniques}
                    standardGuardrails={standardGuardrails}
                  />
                </ConfirmActionDialog>
                <ConfirmActionDialog
                  eyebrow="SCENARIO LIBRARY"
                  title={`Delete ${scenario.title}`}
                  description="Only possible while no role uses it. Deactivate it instead to keep the record."
                  confirmLabel="Delete scenario"
                  tone="danger"
                  action={actions.remove}
                  hidden={{ trialId, scenarioId: scenario.id }}
                  trigger={
                    <IconButton icon={Trash2} size="sm" label={`Delete ${scenario.title}`} />
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
