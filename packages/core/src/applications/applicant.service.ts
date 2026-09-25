import { and, eq } from 'drizzle-orm';
import { applications, applicationStatusChanges } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { loadCatalog } from '../identity/ranks';
import { grantRoleUnchecked } from '../identity/roles.service';
import { cancelJob } from '../jobs/queue';
import { type ServiceContext, withActor, withTransaction } from '../kernel/context';
import {
  ConflictError,
  DisabledError,
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import { systemActor } from '../permissions/actor';
import { requireMember } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { applicantCopy, formatUtc, reviewerCopy } from './copy';
import {
  assertEligibleToApply,
  requireApplicant,
  resolveReferralCode,
  revertApplicantRole,
} from './guards';
import { currentInterviewReminderKey } from './keys';
import {
  type ApplicationPatch,
  type ApplicationRecord,
  applicationNumber,
  findLatestApplication,
  findOpenApplication,
  loadClosures,
  loadStatusHistory,
  transitionApplication,
} from './repository';
import {
  isEligibleToApply,
  missingRequirements,
  reapplyAvailableAt,
  REQUIREMENT_MESSAGES,
  shouldGrantApplicant,
} from './rules';
import { type UpdateDraftInput, updateDraftSchema, withdrawSchema } from './schemas';
import { isOpenStatus } from './state-machine';
import { type ApplicantApplicationView, toApplicantView } from './views';

/** Applicant self-service. Every function acts only on the caller's own application. */

async function applicantView(
  ctx: ServiceContext,
  app: ApplicationRecord,
): Promise<ApplicantApplicationView> {
  const settings = await getSettings(ctx, 'applications');
  const history = await loadStatusHistory(ctx, app.id);
  return toApplicantView(app, history, { draftExpiryDays: settings.draftExpiryDays });
}

export interface DraftResult {
  application: ApplicantApplicationView;
  created: boolean;
}

/**
 * Return the caller's open application, or start a new draft. One open
 * application per person is enforced by a partial unique index, so racing
 * calls converge on the same row.
 */
export async function getOrCreateDraft(ctx: ServiceContext): Promise<DraftResult> {
  const actor = requireApplicant(ctx);
  assertEligibleToApply(actor);
  return withTransaction(ctx, async (tx) => {
    const existing = await findOpenApplication(tx, actor.userId);
    if (existing) return { application: await applicantView(tx, existing), created: false };
    const settings = await getSettings(tx, 'applications');
    if (!settings.open) throw new DisabledError('Applications');
    const now = tx.clock.now();
    const [row] = await tx.db
      .insert(applications)
      .values({ userId: actor.userId, status: 'draft', createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const winner = await findOpenApplication(tx, actor.userId);
      if (!winner) throw new ConflictError('Could not start an application. Try again.');
      return { application: await applicantView(tx, winner), created: false };
    }
    await tx.db.insert(applicationStatusChanges).values({
      applicationId: row.id,
      fromStatus: null,
      toStatus: 'draft',
      actorUserId: actor.userId,
      createdAt: now,
    });
    return { application: await applicantView(tx, row), created: true };
  });
}

async function loadOwnDraft(ctx: ServiceContext, userId: string): Promise<ApplicationRecord> {
  const app = await findOpenApplication(ctx, userId, { forUpdate: true });
  if (!app) throw new NotFoundError('Draft application');
  if (app.status !== 'draft') {
    throw new InvalidStateError('This application is already submitted and can no longer change.');
  }
  return app;
}

/**
 * Patch the caller's draft. Omitted fields stay as they are; null or an
 * empty string clears a field. Mirrors the bot's modal pages.
 */
export async function updateDraft(
  ctx: ServiceContext,
  input: UpdateDraftInput,
): Promise<ApplicantApplicationView> {
  const actor = requireApplicant(ctx);
  const data = parseInput(updateDraftSchema, input);

  const patch: ApplicationPatch = {};
  if (data.domainKey !== undefined) {
    if (data.domainKey !== null) {
      const catalog = await loadCatalog(ctx);
      if (!catalog.domains.some((domain) => domain.key === data.domainKey)) {
        throw new ValidationError('Unknown domain.', [
          { path: 'domainKey', message: 'unknown domain' },
        ]);
      }
    }
    patch.domainKey = data.domainKey;
  }
  if (data.referralCode !== undefined) {
    patch.referralCode =
      data.referralCode === null
        ? null
        : await resolveReferralCode(ctx, data.referralCode, actor.userId);
  }
  if (data.experience !== undefined) patch.experience = data.experience;
  if (data.projects !== undefined) patch.projects = data.projects;
  if (data.motivation !== undefined) patch.motivation = data.motivation;
  if (data.references !== undefined) patch.references = data.references;
  if (data.portfolioUrl !== undefined) patch.portfolioUrl = data.portfolioUrl;
  if (data.evidenceLinks !== undefined) patch.evidenceLinks = data.evidenceLinks;

  return withTransaction(ctx, async (tx) => {
    const app = await loadOwnDraft(tx, actor.userId);
    if (Object.keys(patch).length === 0) return applicantView(tx, app);
    const [updated] = await tx.db
      .update(applications)
      .set({ ...patch, updatedAt: tx.clock.now() })
      .where(and(eq(applications.id, app.id), eq(applications.status, 'draft')))
      .returning();
    if (!updated) throw new ConflictError('This application changed. Reload and try again.');
    return applicantView(tx, updated);
  });
}

/**
 * Submit the caller's draft: applications must be open, no reapply cooldown
 * may be running (after a rejection, or after withdrawing a submitted
 * application), and every requirement must be met. Grants APPLICANT to plain
 * members, notifies reviewers and posts the review card.
 */
export async function submitApplication(ctx: ServiceContext): Promise<ApplicantApplicationView> {
  const actor = requireApplicant(ctx);
  assertEligibleToApply(actor);
  const settings = await getSettings(ctx, 'applications');
  if (!settings.open) throw new DisabledError('Applications');
  const now = ctx.clock.now();
  const catalog = await loadCatalog(ctx);

  return withTransaction(ctx, async (tx) => {
    // Read after locking the draft: it is this person's only open
    // application, so no closure can be added while the check runs.
    const app = await loadOwnDraft(tx, actor.userId);
    const availableAt = reapplyAvailableAt(await loadClosures(tx, actor.userId), settings, now);
    if (availableAt) {
      throw new InvalidStateError(`You can apply again from ${formatUtc(availableAt)}.`, {
        availableAt: availableAt.toISOString(),
      });
    }
    const missing = missingRequirements(app);
    const [first] = missing;
    if (first) {
      throw new ValidationError(
        REQUIREMENT_MESSAGES[first],
        missing.map((requirement) => ({
          path: requirement,
          message: REQUIREMENT_MESSAGES[requirement],
        })),
      );
    }
    if (app.referralCode) await resolveReferralCode(tx, app.referralCode, actor.userId);

    const number = applicationNumber(app);
    const submitted = await transitionApplication(tx, app, 'submitted', {
      set: { submittedAt: now },
      subjectMemberId: actor.memberId,
    });
    if (shouldGrantApplicant(actor.roles)) {
      await grantRoleUnchecked(withActor(tx, systemActor('application submitted')), {
        memberId: actor.memberId,
        role: 'applicant',
        reason: `${number} submitted`,
      });
    }
    await recordAudit(tx, {
      action: 'application.submitted',
      targetType: 'application',
      targetId: app.id,
      context: { number, domainKey: app.domainKey, referred: Boolean(app.referralCode) },
    });
    await publishEvent(tx, {
      type: 'application.submitted',
      aggregateType: 'application',
      aggregateId: app.id,
      subjectMemberId: actor.memberId,
      payload: {
        applicationId: app.id,
        number,
        domainKey: app.domainKey,
        referred: Boolean(app.referralCode),
      },
    });
    await notify(tx, {
      recipientUserId: actor.userId,
      type: 'application.updated',
      ...applicantCopy.submitted(number),
      data: { applicationId: app.id, number },
      dedupeKey: `application:${app.id}:submitted`,
    });
    const domainLabel = catalog.domains.find((domain) => domain.key === app.domainKey)?.label;
    await notifyCapabilityHolders(
      tx,
      'canReviewApplications',
      {
        type: 'application.received',
        ...reviewerCopy.received(number, domainLabel ?? null),
        data: { applicationId: app.id, number },
        dedupeKey: `application:${app.id}:received`,
      },
      { excludeUserIds: [actor.userId] },
    );
    return applicantView(tx, submitted);
  });
}

/**
 * Withdraw the caller's open application from any open state. Withdrawing a
 * submitted application starts a reapply cooldown (see closureCooldownMs).
 */
export async function withdrawApplication(
  ctx: ServiceContext,
  input: { reason?: string } = {},
): Promise<ApplicantApplicationView> {
  const actor = requireMember(ctx);
  const data = parseInput(withdrawSchema, input);
  return withTransaction(ctx, async (tx) => {
    const app = await findOpenApplication(tx, actor.userId, { forUpdate: true });
    if (!app) throw new NotFoundError('Open application');
    const number = applicationNumber(app);
    const withdrawn = await transitionApplication(tx, app, 'withdrawn', {
      note: data.reason ?? 'withdrawn by applicant',
      subjectMemberId: actor.memberId,
    });
    const reminderKey = currentInterviewReminderKey(app);
    if (reminderKey) await cancelJob(tx, reminderKey);
    // Only a submission granted APPLICANT; discarding a draft leaves roles alone.
    if (app.submittedAt) {
      await revertApplicantRole(
        withActor(tx, systemActor('application withdrawn')),
        actor.memberId,
        `${number} withdrawn`,
      );
    }
    await recordAudit(tx, {
      action: 'application.withdrawn',
      targetType: 'application',
      targetId: app.id,
      context: { number, from: app.status },
    });
    await publishEvent(tx, {
      type: 'application.withdrawn',
      aggregateType: 'application',
      aggregateId: app.id,
      subjectMemberId: actor.memberId,
      payload: { applicationId: app.id, number, from: app.status, by: 'applicant' },
    });
    return applicantView(tx, withdrawn);
  });
}

export interface MyApplicationStatus {
  /** The open application, else the most recent closed one, else null. */
  application: ApplicantApplicationView | null;
  applicationsOpen: boolean;
  /** False when the caller already holds TRIAL, VERIFIED or a staff role. */
  eligible: boolean;
  /** Set while a cooldown (after a rejection or a withdrawal) blocks a new submission. */
  cooldownEndsAt: Date | null;
  /**
   * When the person could submit again if they withdrew the open application
   * now; null when withdrawing starts no cooldown or nothing is open. Show it
   * before a withdrawal is confirmed.
   */
  withdrawalCooldownEndsAt: Date | null;
}

/** Applicant-safe status: never decision reasons, reviews or reviewer identities. */
export async function getMyApplication(ctx: ServiceContext): Promise<MyApplicationStatus> {
  const actor = requireMember(ctx);
  const settings = await getSettings(ctx, 'applications');
  const latest = await findLatestApplication(ctx, actor.userId);
  const closures = await loadClosures(ctx, actor.userId);
  const now = ctx.clock.now();
  const open = latest && isOpenStatus(latest.status) ? latest : null;
  return {
    application: latest ? await applicantView(ctx, latest) : null,
    applicationsOpen: settings.open,
    eligible: isEligibleToApply(actor.roles),
    cooldownEndsAt: reapplyAvailableAt(closures, settings, now),
    withdrawalCooldownEndsAt: open
      ? reapplyAvailableAt(
          [...closures, { outcome: 'withdrawn', from: open.status, at: now }],
          settings,
          now,
        )
      : null,
  };
}
