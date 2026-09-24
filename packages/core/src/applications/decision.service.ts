import type { z } from 'zod';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { grantRoleUnchecked } from '../identity/roles.service';
import { activeRoles } from '../identity/users.service';
import { cancelJob } from '../jobs/queue';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { notify } from '../notifications/notifications.service';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { type OrgRole } from '../permissions/roles';
import { getSettings } from '../settings/settings.service';
import { applicantCopy } from './copy';
import { assertNotOwnApplication, revertApplicantRole } from './guards';
import { currentInterviewReminderKey } from './keys';
import {
  applicantMemberId,
  applicationNumber,
  loadReviews,
  loadSubmittedApplication,
  transitionApplication,
} from './repository';
import { ACCEPTANCE_ROLES, acceptanceGrant, cooldownEndsAt, tallyReviews } from './rules';
import { decideSchema } from './schemas';
import { assertTransition } from './state-machine';
import { type ApplicationStaffSummary, toStaffSummary } from './review.service';

function isAcceptanceRole(value: string): value is OrgRole {
  return (ACCEPTANCE_ROLES as readonly string[]).includes(value);
}

export interface DecisionResult extends ApplicationStaffSummary {
  decision: 'accept' | 'reject';
  /** Role granted on acceptance; null when the member already held it or higher. */
  grantedRole: OrgRole | null;
}

/**
 * Accept or reject. Needs canDecideApplications, an internal reason, and at
 * least settings.applications.minReviewsBeforeDecision non-abstaining
 * reviews. Nobody decides their own application.
 *
 * Accept grants settings.applications.acceptedRole (TRIAL or VERIFIED only —
 * anything else is refused as a misconfiguration). Reject returns APPLICANT
 * to MEMBER. The applicant hears only the outcome and the optional
 * applicant message, never the internal reason.
 */
export async function decideApplication(
  ctx: ServiceContext,
  input: z.input<typeof decideSchema>,
): Promise<DecisionResult> {
  const data = parseInput(decideSchema, input);
  await authorize(ctx, 'canDecideApplications', { type: 'application', id: data.applicationId });
  const app = await loadSubmittedApplication(ctx, data.applicationId);
  await assertNotOwnApplication(ctx, app, 'decide');
  const to = data.decision === 'accept' ? 'accepted' : 'rejected';
  assertTransition(app.status, to);
  const settings = await getSettings(ctx, 'applications');
  const acceptedRole = settings.acceptedRole;
  if (data.decision === 'accept' && !isAcceptanceRole(acceptedRole)) {
    throw new InvalidStateError(
      'Accepted role must be TRIAL or VERIFIED. Fix settings.applications.acceptedRole.',
      { acceptedRole },
    );
  }

  return withTransaction(ctx, async (tx) => {
    const current = await loadSubmittedApplication(tx, app.id, { forUpdate: true });
    assertTransition(current.status, to);
    const tally = tallyReviews(await loadReviews(tx, current.id));
    if (tally.counted < settings.minReviewsBeforeDecision) {
      throw new InvalidStateError(
        `A decision needs ${settings.minReviewsBeforeDecision} review(s). ${tally.counted} so far.`,
        { required: settings.minReviewsBeforeDecision, counted: tally.counted },
      );
    }
    const memberId = await applicantMemberId(tx, current.userId);
    if (data.decision === 'accept' && !memberId) {
      throw new InvalidStateError('The applicant no longer has a JAVELIN profile.');
    }
    const now = tx.clock.now();
    const number = applicationNumber(current);
    const decided = await transitionApplication(tx, current, to, {
      set: {
        decidedAt: now,
        decidedByUserId: actorUserId(tx.actor),
        decisionReason: data.reason,
        applicantMessage: data.applicantMessage ?? null,
      },
      note: `decision: ${data.decision}`,
      subjectMemberId: memberId,
    });
    const reminderKey = currentInterviewReminderKey(current);
    if (reminderKey) await cancelJob(tx, reminderKey);

    let grantedRole: OrgRole | null = null;
    if (data.decision === 'accept' && memberId && isAcceptanceRole(acceptedRole)) {
      const grant = acceptanceGrant(await activeRoles(tx, memberId), acceptedRole);
      if (grant) {
        await grantRoleUnchecked(tx, { memberId, role: grant, reason: `${number} accepted` });
        grantedRole = grant;
      }
    } else if (data.decision === 'reject' && memberId) {
      await revertApplicantRole(tx, memberId, `${number} not accepted`);
    }

    await recordAudit(tx, {
      action: 'application.decided',
      targetType: 'application',
      targetId: current.id,
      context: {
        number,
        decision: data.decision,
        reason: data.reason,
        grantedRole,
        reviews: { counted: tally.counted, averageScore: tally.averageScore },
      },
    });
    await publishEvent(tx, {
      type: data.decision === 'accept' ? 'application.accepted' : 'application.rejected',
      aggregateType: 'application',
      aggregateId: current.id,
      subjectMemberId: memberId,
      payload: { applicationId: current.id, number, grantedRole },
    });
    const copy =
      data.decision === 'accept'
        ? applicantCopy.accepted(number, grantedRole, data.applicantMessage ?? null)
        : applicantCopy.rejected(
            number,
            cooldownEndsAt(now, settings.cooldownDaysAfterRejection, now),
            data.applicantMessage ?? null,
          );
    await notify(tx, {
      recipientUserId: current.userId,
      type: 'application.updated',
      ...copy,
      data: { applicationId: current.id, number, outcome: to },
      dedupeKey: `application:${current.id}:decision`,
    });
    return { ...toStaffSummary(decided), decision: data.decision, grantedRole };
  });
}
