import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import { failure } from '../../ui/components';
import {
  isConfirmedOperation,
  isPickPurpose,
  MEMBER_ACTIONS,
  type PickPurpose,
  STAFF_ACTIONS,
  TRIALS_NS,
} from './ids';
import {
  completeApplication,
  completeSubmission,
  confirmWithdraw,
  executeWithdraw,
  openApplyModal,
  openSubmitModal,
  requireTrialId,
  requireUuid,
  showStatus,
  showTeams,
  showTrial,
} from './member-flows';
import {
  applyManualSelection,
  askConfirmation,
  offerEvaluation,
  offerManualSelection,
  openEvaluationModal,
  openModal,
  openPanel,
  runOperation,
  submitAssignment,
  submitCancellation,
  submitEvaluation,
  submitExtension,
  submitRandomSelection,
} from './staff-flows';

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

async function picked(h: HandlerContext, purpose: PickPurpose): Promise<void> {
  const trialId = requireTrialId(h.interaction.values[0]);
  switch (purpose) {
    case 'view':
      return showTrial(h, trialId);
    case 'apply':
      return openApplyModal(h, trialId);
    case 'submit':
      return openSubmitModal(h, trialId);
    case 'withdraw':
      return confirmWithdraw(h, trialId);
    case 'manage':
      return openPanel(h, trialId);
  }
}

/**
 * Buttons and select menus in the `trials` namespace. The custom id only
 * routes: the trial id it carries is re-validated, and every action is
 * authorized by core as the clicking user.
 */
export const trialComponents: ComponentHandler = {
  namespace: TRIALS_NS,
  async handle(h, action, args) {
    switch (action) {
      case MEMBER_ACTIONS.status:
        return showStatus(h);
      case MEMBER_ACTIONS.team:
        return showTeams(h);
      case MEMBER_ACTIONS.pick:
        return isPickPurpose(args[0]) ? picked(h, args[0]) : expired(h);
    }
    const trialId = requireTrialId(action === STAFF_ACTIONS.ask || action === STAFF_ACTIONS.run ? args[1] : args[0]);
    switch (action) {
      case MEMBER_ACTIONS.view:
        return showTrial(h, trialId);
      case MEMBER_ACTIONS.apply:
        return openApplyModal(h, trialId);
      case MEMBER_ACTIONS.submit:
        return openSubmitModal(h, trialId);
      case MEMBER_ACTIONS.withdraw:
        return confirmWithdraw(h, trialId);
      case MEMBER_ACTIONS.withdrawConfirm:
        return executeWithdraw(h, trialId);
      case STAFF_ACTIONS.panel:
        return openPanel(h, trialId);
      case STAFF_ACTIONS.ask:
        return isConfirmedOperation(args[0]) ? askConfirmation(h, args[0], trialId) : expired(h);
      case STAFF_ACTIONS.run:
        return isConfirmedOperation(args[0]) ? runOperation(h, args[0], trialId) : expired(h);
      case STAFF_ACTIONS.selectRandom:
      case STAFF_ACTIONS.extend:
      case STAFF_ACTIONS.cancel:
      case STAFF_ACTIONS.assign:
        return openModal(h, action, trialId);
      case STAFF_ACTIONS.selectManual:
        return offerManualSelection(h, trialId);
      case STAFF_ACTIONS.selectPick:
        return applyManualSelection(h, trialId);
      case STAFF_ACTIONS.evaluate:
        return offerEvaluation(h, trialId);
      case STAFF_ACTIONS.evaluateTeam:
        return openEvaluationModal(h, trialId);
      default:
        return expired(h);
    }
  },
};

/** Modal submissions in the `trials` namespace. */
export const trialModals: ModalHandler = {
  namespace: TRIALS_NS,
  async handle(h, action, args) {
    const trialId = requireTrialId(args[0]);
    switch (action) {
      case MEMBER_ACTIONS.apply:
        return completeApplication(h, trialId);
      case MEMBER_ACTIONS.submit:
        return completeSubmission(h, trialId);
      case STAFF_ACTIONS.selectRandom:
        return submitRandomSelection(h, trialId);
      case STAFF_ACTIONS.assign:
        return submitAssignment(h, trialId);
      case STAFF_ACTIONS.extend:
        return submitExtension(h, trialId);
      case STAFF_ACTIONS.cancel:
        return submitCancellation(h, trialId);
      case STAFF_ACTIONS.evaluate:
        return submitEvaluation(h, trialId, requireUuid(args[1], 'a team'));
      default:
        return expired(h);
    }
  },
};
