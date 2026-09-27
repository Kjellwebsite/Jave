import { applications } from '@jave/core';
import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import { failure } from '../../ui/components';
import type { BotFeature } from '../types';
import { applyCommand, handleApplicantComponent, handleApplicantModal } from './applicant-handlers';
import { APPLICATIONS_NS, STAFF_ACTIONS } from './ids';
import { reviewCardJobHandler } from './review-card-job';
import {
  handleCardAction,
  isStaffAction,
  openDecisionForm,
  showDetails,
  submitDecision,
  submitInterview,
  submitReview,
} from './staff-handlers';
import { applicationsQueueCommand, handleQueueComponent } from './staff-queue';

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

const components: ComponentHandler = {
  namespace: APPLICATIONS_NS,
  async handle(h, action, args) {
    if (await handleApplicantComponent(h, action, args)) return;
    if (await handleQueueComponent(h, action, args, showDetails)) return;
    if (isStaffAction(action)) return handleCardAction(h, action, args[0]);
    if (action === STAFF_ACTIONS.details) return showDetails(h, args[0]);
    if (action === STAFF_ACTIONS.decide) return openDecisionForm(h, args[0], args[1]);
    await expired(h);
  },
};

const modals: ModalHandler = {
  namespace: APPLICATIONS_NS,
  async handle(h, action, args) {
    if (await handleApplicantModal(h, action, args)) return;
    switch (action) {
      case STAFF_ACTIONS.reviewSubmit:
        return submitReview(h, args[0]);
      case STAFF_ACTIONS.interviewSubmit:
        return submitInterview(h, args[0]);
      case STAFF_ACTIONS.decideSubmit:
        return submitDecision(h, args[0], args[1]);
      default:
        await expired(h);
    }
  },
};

/** Discord surface for the applications domain: /apply, the staff queue and review cards. */
export const feature: BotFeature = {
  name: 'applications',
  commands: [applyCommand, applicationsQueueCommand],
  components: [components],
  modals: [modals],
  jobHandlers: (services) => ({
    [applications.APPLICATION_REVIEW_CARD_JOB]: reviewCardJobHandler(services),
  }),
};
