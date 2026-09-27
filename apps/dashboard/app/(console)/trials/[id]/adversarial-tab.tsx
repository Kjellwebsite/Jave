import { adversarial, can, getSettings, trials } from '@jave/core';
import { AdversarialPanel, type OperativeOption } from '@/components/trials/adversarial/adversarial-panel';
import type { ScenarioRow } from '@/components/trials/adversarial/scenario-library';
import type { UserContext } from '@/server/context';
import type { Viewer } from '@/server/data/viewer';
import {
  abortRoleAction,
  activateRoleAction,
  addTriggerAction,
  authorizeRoleAction,
  briefRoleAction,
  concludeRoleAction,
  createScenarioAction,
  deleteScenarioAction,
  evaluateRoleAction,
  planRoleAction,
  recordObservationAction,
  revealRoleAction,
  seedScenariosAction,
  setTrialAdversarialAction,
  updateScenarioAction,
} from './adversarial-actions';

type StaffView = trials.StaffTrialView;

const ROLE_PAGE = 50;
const SCENARIO_PAGE = 100;
/** Roles can be planned until the trial ends (the adversarial service enforces it). */
const PLANNING_STATES: readonly trials.TrialStatus[] = [...trials.EDITABLE_STATUSES, 'active'];

/**
 * Staff-only (canManageAdversarial). Reads are audited by the adversarial
 * service; trials the viewer takes part in never reach this tab (the staff
 * view refuses them first).
 */
export async function AdversarialTab({
  ctx,
  view,
  viewer,
}: {
  ctx: UserContext;
  view: StaffView;
  viewer: Viewer;
}) {
  const [settings, page, library] = await Promise.all([
    getSettings(ctx, 'trials'),
    adversarial.listRoles(ctx, { trialId: view.id, limit: ROLE_PAGE }),
    adversarial.listScenarios(ctx, { limit: SCENARIO_PAGE }),
  ]);
  const roles = await Promise.all(
    page.items.map((summary) => adversarial.getRole(ctx, { roleId: summary.id })),
  );
  const names = new Map(view.participants.map((p) => [p.memberId, p.displayName]));
  // Candidates only: the service checks role (VERIFIED/staff), standing and selection.
  const operatives: OperativeOption[] = view.teams.flatMap((team) =>
    team.members.map((member) => ({
      value: `${team.id}:${member.memberId}`,
      label: `${team.name} — ${member.displayName}`,
    })),
  );
  const scenarios: ScenarioRow[] = library.items.map((scenario) => ({
    id: scenario.id,
    key: scenario.key,
    title: scenario.title,
    technique: scenario.technique,
    description: scenario.description,
    objective: scenario.objective,
    guardrails: scenario.guardrails,
    sandboxAssets: scenario.sandboxAssets,
    active: scenario.active,
  }));
  const techniques = Object.entries(adversarial.TECHNIQUE_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <AdversarialPanel
      trialId={view.id}
      trialStatus={view.status}
      globalEnabled={settings.adversarialEnabled}
      trialEnabled={view.adversarialEnabled === true}
      toggleAllowed={trials.EDITABLE_STATUSES.includes(view.status)}
      planningAllowed={PLANNING_STATES.includes(view.status)}
      roles={roles}
      operatives={operatives}
      scenarios={scenarios}
      techniques={techniques}
      techniqueLabels={adversarial.TECHNIQUE_LABELS}
      outcomeLabels={adversarial.OUTCOME_LABELS}
      standardGuardrails={adversarial.STANDARD_GUARDRAILS}
      names={names}
      viewerUserId={viewer.userId}
      canAuthorize={can(ctx, 'canAuthorizeAdversarial')}
      timeZone={viewer.timeZone}
      actions={{
        toggle: setTrialAdversarialAction,
        plan: planRoleAction,
        authorize: authorizeRoleAction,
        brief: briefRoleAction,
        activate: activateRoleAction,
        conclude: concludeRoleAction,
        abort: abortRoleAction,
        addTrigger: addTriggerAction,
        observe: recordObservationAction,
        evaluate: evaluateRoleAction,
        reveal: revealRoleAction,
        createScenario: createScenarioAction,
        updateScenario: updateScenarioAction,
        deleteScenario: deleteScenarioAction,
        seedScenarios: seedScenariosAction,
      }}
    />
  );
}
