import 'server-only';
import { notFound, redirect } from 'next/navigation';
import {
  applications,
  can,
  ForbiddenError,
  getSettings,
  NotFoundError,
  UnauthenticatedError,
} from '@jave/core';
import { LOGIN_PATH } from '@/lib/routes';
import type { UserContext } from '../context';

type StaffAction = applications.StaffAction;

export interface StaffApplicationPage {
  view: applications.StaffApplicationView;
  card: applications.ReviewCard;
  /** Controls this viewer can use now: capability and state, as core reports them. */
  controls: {
    claim: boolean;
    review: boolean;
    interview: boolean;
    accept: boolean;
    reject: boolean;
  };
  settings: { acceptedRole: string; minReviews: number; cooldownDays: number };
}

export type StaffApplicationLoad =
  { ok: true; page: StaffApplicationPage } | { ok: false; reason: string };

/**
 * The staff view of one application. Refusals keep their reason (a missing
 * capability, or the viewer's own application), so the page can say which.
 */
export async function loadStaffApplication(
  ctx: UserContext,
  applicationId: string,
): Promise<StaffApplicationLoad> {
  try {
    const view = await applications.getApplication(ctx, { applicationId });
    const [card, settings] = await Promise.all([
      applications.getReviewCard(ctx, { applicationId }),
      getSettings(ctx, 'applications'),
    ]);
    const offered = (action: StaffAction) => card.actions.includes(action);
    const review = can(ctx, 'canReviewApplications');
    const decide = can(ctx, 'canDecideApplications');
    return {
      ok: true,
      page: {
        view,
        card,
        controls: {
          claim: review && offered('start_review'),
          review: review && offered('review'),
          interview: decide && offered('schedule_interview'),
          accept: decide && offered('accept'),
          reject: decide && offered('reject'),
        },
        settings: {
          acceptedRole: settings.acceptedRole,
          minReviews: settings.minReviewsBeforeDecision,
          cooldownDays: settings.cooldownDaysAfterRejection,
        },
      },
    };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, reason: error.userMessage };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof UnauthenticatedError) redirect(LOGIN_PATH);
    throw error;
  }
}
