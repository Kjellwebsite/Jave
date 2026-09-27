import { FlaskConical, ShieldAlert, UserPlus } from 'lucide-react';
import type { adversarial } from '@jave/core';
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Icon,
  NativeSelect,
  StatusBadge,
  Textarea,
} from '@jave/ui';
import type { ObservationOutcomeKey } from '@/lib/trial-labels';
import type { FormAction } from '../../forms/action-form';
import { ConfirmActionDialog } from '../../forms/confirm-action-dialog';
import { FormField } from '../../forms/form-field';
import { type RoleActions, RoleCard } from './role-card';
import { ScenarioLibrary, type ScenarioRow } from './scenario-library';

export interface OperativeOption {
  /** `teamId:memberId`. */
  value: string;
  label: string;
}

export interface AdversarialPanelProps {
  trialId: string;
  trialStatus: string;
  /** Global kill switch (settings.trials.adversarialEnabled). */
  globalEnabled: boolean;
  trialEnabled: boolean;
  /** The trial can still change adversarial settings (draft … teams_assigned). */
  toggleAllowed: boolean;
  /** Roles can still be planned (draft … active). */
  planningAllowed: boolean;
  roles: readonly adversarial.RoleDetail[];
  operatives: readonly OperativeOption[];
  scenarios: readonly ScenarioRow[];
  techniques: readonly { value: string; label: string }[];
  techniqueLabels: Readonly<Record<string, string>>;
  outcomeLabels: Readonly<Record<ObservationOutcomeKey, string>>;
  standardGuardrails: string;
  names: ReadonlyMap<string, string>;
  viewerUserId: string;
  canAuthorize: boolean;
  timeZone: string;
  actions: RoleActions & {
    toggle: FormAction;
    plan: FormAction;
    createScenario: FormAction;
    updateScenario: FormAction;
    deleteScenario: FormAction;
    seedScenarios: FormAction;
  };
}

const OBJECTIVE_MAX = 1000;

/** The SANDBOX mark every adversarial surface carries. */
export function SandboxBanner() {
  return (
    <div
      role="note"
      data-testid="sandbox-banner"
      className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/8 px-4 py-3"
    >
      <Icon icon={ShieldAlert} className="mt-0.5 text-warning" />
      <div className="min-w-0 space-y-1">
        <p className="type-eyebrow text-warning">SANDBOX · FICTIONAL DATA ONLY · STAFF ONLY</p>
        <p className="text-small text-fg-muted">
          Security-culture exercises inside this trial only: fictional data, sandbox accounts,
          sandbox hosts. Two-person authorization. Anyone saying RED FLAG ends the exercise at once.
          Nothing here ever reaches a participant before the reveal.
        </p>
      </div>
    </div>
  );
}

/** Staff-only adversarial control room for one trial (canManageAdversarial). */
export function AdversarialPanel(props: AdversarialPanelProps) {
  const {
    trialId,
    trialStatus,
    globalEnabled,
    trialEnabled,
    toggleAllowed,
    planningAllowed,
    roles,
    operatives,
    scenarios,
    actions,
  } = props;
  const activeScenarios = scenarios.filter((scenario) => scenario.active);
  const canPlan = globalEnabled && trialEnabled && planningAllowed;

  return (
    <div className="space-y-6">
      <SandboxBanner />

      <Card padding="md" className="flex flex-wrap items-center justify-between gap-4">
        <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <dt className="type-eyebrow text-fg-subtle">GLOBAL SWITCH</dt>
            <dd className="mt-1.5">
              <StatusBadge
                tone={globalEnabled ? 'success' : 'danger'}
                label={globalEnabled ? 'ON' : 'OFF — ALL ROLES BLOCKED'}
              />
            </dd>
          </div>
          <div>
            <dt className="type-eyebrow text-fg-subtle">THIS TRIAL</dt>
            <dd className="mt-1.5">
              <StatusBadge
                tone={trialEnabled ? 'warning' : 'neutral'}
                label={trialEnabled ? 'ROLES ALLOWED' : 'NO ROLES'}
              />
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {toggleAllowed ? (
            <ConfirmActionDialog
              eyebrow="ADVERSARIAL"
              title={trialEnabled ? 'Disallow roles in this trial' : 'Allow roles in this trial'}
              description={
                trialEnabled
                  ? 'No new roles can be planned. Existing roles are unaffected; stop them individually.'
                  : 'Staff may then plan a hidden role under two-person authorization. Participants are never told.'
              }
              confirmLabel={trialEnabled ? 'Disallow' : 'Allow roles'}
              tone={trialEnabled ? 'danger' : 'default'}
              action={actions.toggle}
              hidden={{ trialId, enabled: trialEnabled ? 'false' : 'true' }}
              trigger={<Button size="sm">{trialEnabled ? 'Disallow roles' : 'Allow roles'}</Button>}
            />
          ) : null}
          {canPlan ? (
            <ConfirmActionDialog
              eyebrow="ADVERSARIAL · PLAN"
              title="Plan a role"
              description="One operative on one team. The operative must be a VERIFIED or staff member selected on that team. A second person authorizes before any briefing."
              confirmLabel="Plan role"
              action={actions.plan}
              hidden={{ trialId }}
              trigger={
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={UserPlus}
                  disabled={operatives.length === 0 || activeScenarios.length === 0}
                  data-testid="plan-role"
                >
                  Plan role
                </Button>
              }
            >
              <FormField name="operative" label="Operative" required>
                <NativeSelect
                  name="operative"
                  defaultValue={operatives[0]?.value}
                  options={operatives}
                />
              </FormField>
              <FormField name="scenarioId" label="Scenario" required>
                <NativeSelect
                  name="scenarioId"
                  defaultValue={activeScenarios[0]?.id}
                  options={activeScenarios.map((scenario) => ({
                    value: scenario.id,
                    label: scenario.title,
                  }))}
                />
              </FormField>
              <FormField
                name="objective"
                label="Objective"
                description="Optional. Defaults to the scenario objective. Validated for safety."
              >
                <Textarea name="objective" maxLength={OBJECTIVE_MAX} rows={3} />
              </FormField>
            </ConfirmActionDialog>
          ) : null}
        </div>
      </Card>

      {!globalEnabled ? (
        <Callout tone="danger" title="KILL SWITCH OFF">
          Adversarial roles are disabled in settings. Every running exercise was stopped; nothing
          can be planned until it is turned on again.
        </Callout>
      ) : null}
      {canPlan && operatives.length === 0 ? (
        <p className="text-small text-fg-subtle">
          No eligible operative yet: roles need a VERIFIED or staff participant selected on a team.
        </p>
      ) : null}

      {roles.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={FlaskConical}
            title="NO ROLES"
            description={
              trialEnabled
                ? 'This trial runs without an operative until one is planned and authorized.'
                : `Roles are not allowed in this trial${trialStatus === 'draft' ? ' yet' : ''}.`
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {roles.map((role) => (
            <RoleCard
              key={role.id}
              trialId={trialId}
              role={role}
              names={props.names}
              viewerUserId={props.viewerUserId}
              canAuthorize={props.canAuthorize}
              outcomeLabels={props.outcomeLabels}
              techniqueLabel={props.techniqueLabels[role.scenario.technique] ?? role.scenario.technique}
              timeZone={props.timeZone}
              actions={actions}
            />
          ))}
        </div>
      )}

      <ScenarioLibrary
        trialId={trialId}
        scenarios={scenarios}
        techniques={props.techniques}
        standardGuardrails={props.standardGuardrails}
        actions={{
          create: actions.createScenario,
          update: actions.updateScenario,
          remove: actions.deleteScenario,
          seed: actions.seedScenarios,
        }}
      />
    </div>
  );
}
