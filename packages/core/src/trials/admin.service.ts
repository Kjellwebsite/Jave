import { and, count, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { trialParticipants, trials } from '@jave/database';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { cancelJob } from '../jobs/queue';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { actorUserId } from '../permissions/actor';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';
import { ANNOUNCE_PHASE, dedupeKeys, LIMITS, trialRef } from './constants';
import {
  cancelAutoStart,
  cancelDeadlineJobs,
  enqueueAnnouncement,
  enqueueArchive,
  notifyEach,
  scheduleAutoStart,
} from './effects';
import { assertNoConflictOfInterest, assertTrialsEnabled } from './guards';
import { notices } from './notices';
import {
  loadParticipantDetails,
  loadTeams,
  loadTrial,
  STAKE_STATUSES,
  type TrialRecord,
} from './repository';
import {
  cancelTrialSchema,
  createTrialSchema,
  openRecruitmentSchema,
  setAdversarialSchema,
  updateTrialSchema,
} from './schemas';
import { assertStatus, assertTransition, EDITABLE_STATUSES } from './state-machine';
import { assertFacetKeys, loadTemplate } from './templates.service';
import { type TrialSummaryView, toSummaryView } from './views.shared';

/** Fields whose change alters the public recruitment card. */
const CARD_FIELDS: readonly string[] = [
  'title',
  'summary',
  'teamSize',
  'durationMinutes',
  'maxParticipants',
  'recruitmentClosesAt',
];

function assertFuture(ctx: ServiceContext, value: Date | null | undefined, field: string): void {
  if (value && value.getTime() <= ctx.clock.now().getTime())
    throw new ValidationError(`${field} must be in the future.`, [
      { path: field, message: 'must be in the future' },
    ]);
}

/** A scheduled start never precedes the end of recruitment. */
function assertScheduleOrder(
  recruitmentClosesAt: Date | null | undefined,
  scheduledStartAt: Date | null | undefined,
): void {
  if (
    recruitmentClosesAt &&
    scheduledStartAt &&
    scheduledStartAt.getTime() < recruitmentClosesAt.getTime()
  )
    throw new ValidationError('The scheduled start must not precede the recruitment close.', [
      { path: 'scheduledStartAt', message: 'before recruitmentClosesAt' },
    ]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Adversarial roles need three keys: the canManageAdversarial capability, the
 * global kill switch, and (for template-based trials) a template that allows them.
 */
async function assertAdversarialAllowed(
  ctx: ServiceContext,
  templateAllows: boolean | null,
  trialId?: string,
): Promise<void> {
  await authorize(ctx, 'canManageAdversarial', { type: 'trial', id: trialId ?? null });
  if (!(await getSettings(ctx, 'trials')).adversarialEnabled)
    throw new InvalidStateError('Adversarial roles are disabled in settings.');
  if (templateAllows === false)
    throw new ValidationError('This template does not allow adversarial roles.');
}

/**
 * Keep time-based jobs in step with edited dates: the recruitment card's
 * closing refresh, and the automatic start once teams are assigned.
 */
async function rescheduleTimers(
  ctx: ServiceContext,
  trial: TrialRecord,
  patch: { recruitmentClosesAt?: Date | null; scheduledStartAt?: Date | null },
): Promise<void> {
  const moved = (next: Date | null | undefined, current: Date | null) =>
    next !== undefined && next?.getTime() !== current?.getTime();
  if (
    trial.status === 'recruiting' &&
    moved(patch.recruitmentClosesAt, trial.recruitmentClosesAt)
  ) {
    await cancelJob(ctx, dedupeKeys.announce(trial.id, ANNOUNCE_PHASE.closes));
    if (patch.recruitmentClosesAt)
      await enqueueAnnouncement(ctx, trial.id, ANNOUNCE_PHASE.closes, patch.recruitmentClosesAt);
  }
  if (trial.status === 'teams_assigned' && moved(patch.scheduledStartAt, trial.scheduledStartAt)) {
    if (trial.scheduledStartAt) await cancelAutoStart(ctx, trial.id, trial.scheduledStartAt);
    if (patch.scheduledStartAt) await scheduleAutoStart(ctx, trial.id, patch.scheduledStartAt);
  }
}

export async function createTrial(
  ctx: ServiceContext,
  input: z.input<typeof createTrialSchema>,
): Promise<TrialSummaryView> {
  const data = parseInput(createTrialSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial' });
  await assertTrialsEnabled(ctx);
  const template = data.templateId ? await loadTemplate(ctx, data.templateId) : null;
  if (template && !template.active)
    throw new InvalidStateError('That template is inactive. Reactivate it or pick another.');

  const title = data.title ?? template?.title;
  const category = data.category ?? template?.category;
  const brief = data.brief ?? template?.brief;
  const rubric = data.rubric ?? template?.rubric;
  const durationMinutes = data.durationMinutes ?? template?.durationMinutes;
  if (!title || !category || !brief || !rubric || !durationMinutes)
    throw new ValidationError(
      'A custom trial needs a title, category, brief, rubric and duration — or a template.',
    );
  const facetKeys = data.facetKeys ?? template?.facetKeys ?? [];
  await assertFacetKeys(ctx, facetKeys);
  assertFuture(ctx, data.recruitmentClosesAt, 'recruitmentClosesAt');
  assertFuture(ctx, data.scheduledStartAt, 'scheduledStartAt');
  assertScheduleOrder(data.recruitmentClosesAt, data.scheduledStartAt);
  if (data.adversarialEnabled)
    await assertAdversarialAllowed(ctx, template ? template.allowsAdversarial : null);

  const settings = await getSettings(ctx, 'trials');
  const teamSize =
    data.teamSize ??
    (template
      ? clamp(settings.defaultTeamSize, template.teamSizeMin, template.teamSizeMax)
      : settings.defaultTeamSize);

  return withTransaction(ctx, async (t) => {
    const [trial] = await t.db
      .insert(trials)
      .values({
        templateId: template?.id ?? null,
        title,
        category,
        summary: data.summary ?? template?.summary ?? '',
        brief,
        rubric,
        facetKeys,
        teamSize,
        maxParticipants: data.maxParticipants ?? null,
        durationMinutes,
        recruitmentClosesAt: data.recruitmentClosesAt ?? null,
        scheduledStartAt: data.scheduledStartAt ?? null,
        adversarialEnabled: data.adversarialEnabled,
        createdByUserId: actorUserId(t.actor),
      })
      .returning();
    await recordAudit(t, {
      action: 'trial.created',
      targetType: 'trial',
      targetId: trial!.id,
      context: {
        ref: trialRef(trial!),
        templateId: template?.id ?? null,
        title,
        category,
        adversarialEnabled: data.adversarialEnabled,
      },
    });
    await publishEvent(t, {
      type: 'trial.created',
      aggregateType: 'trial',
      aggregateId: trial!.id,
      payload: { ref: trialRef(trial!), title, category },
    });
    return toSummaryView(trial!, t.clock.now());
  });
}

export async function updateTrial(
  ctx: ServiceContext,
  input: z.input<typeof updateTrialSchema>,
): Promise<TrialSummaryView> {
  const { trialId, ...patch } = parseInput(updateTrialSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: trialId });
  await assertNoConflictOfInterest(ctx, trialId, 'edit it');
  if (patch.facetKeys) await assertFacetKeys(ctx, patch.facetKeys);
  assertFuture(ctx, patch.recruitmentClosesAt, 'recruitmentClosesAt');
  assertFuture(ctx, patch.scheduledStartAt, 'scheduledStartAt');

  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, trialId, 'update');
    assertStatus(trial, EDITABLE_STATUSES, 'edit it');
    if (patch.recruitmentClosesAt !== undefined)
      assertStatus(trial, ['draft', 'recruiting'], 'change its recruitment window');
    assertScheduleOrder(
      patch.recruitmentClosesAt === undefined
        ? trial.recruitmentClosesAt
        : patch.recruitmentClosesAt,
      patch.scheduledStartAt === undefined ? trial.scheduledStartAt : patch.scheduledStartAt,
    );
    if (patch.maxParticipants !== undefined && patch.maxParticipants !== null) {
      const [selected] = await t.db
        .select({ value: count() })
        .from(trialParticipants)
        .where(
          and(eq(trialParticipants.trialId, trialId), eq(trialParticipants.status, 'selected')),
        );
      if ((selected?.value ?? 0) > patch.maxParticipants)
        throw new ValidationError(
          `${selected!.value} participants are already selected — deselect some first.`,
          [{ path: 'maxParticipants', message: 'below the current selection' }],
        );
    }
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
      (key) =>
        patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(trial[key]),
    );
    if (changed.length === 0) return toSummaryView(trial, t.clock.now());
    const [updated] = await t.db
      .update(trials)
      .set(patch)
      .where(eq(trials.id, trialId))
      .returning();
    await recordAudit(t, {
      action: 'trial.updated',
      targetType: 'trial',
      targetId: trialId,
      context: { fields: changed },
    });
    if (trial.status === 'recruiting' && changed.some((field) => CARD_FIELDS.includes(field)))
      await enqueueAnnouncement(t, trialId, ANNOUNCE_PHASE.refresh);
    await rescheduleTimers(t, trial, patch);
    return toSummaryView(updated!, t.clock.now());
  });
}

/** Staff-only switch; never surfaced to participants, never in events. */
export async function setAdversarialEnabled(
  ctx: ServiceContext,
  input: z.input<typeof setAdversarialSchema>,
): Promise<{ trialId: string; adversarialEnabled: boolean }> {
  const data = parseInput(setAdversarialSchema, input);
  await authorize(ctx, 'canManageAdversarial', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'configure it');
  const current = await loadTrial(ctx, data.trialId);
  if (data.enabled) {
    const template = current.templateId ? await loadTemplate(ctx, current.templateId) : null;
    await assertAdversarialAllowed(ctx, template ? template.allowsAdversarial : null, current.id);
  }
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertStatus(trial, EDITABLE_STATUSES, 'change adversarial settings');
    if (trial.adversarialEnabled !== data.enabled) {
      await t.db
        .update(trials)
        .set({ adversarialEnabled: data.enabled })
        .where(eq(trials.id, trial.id));
      await recordAudit(t, {
        action: 'trial.adversarial_toggled',
        targetType: 'trial',
        targetId: trial.id,
        context: { enabled: data.enabled },
      });
    }
    return { trialId: trial.id, adversarialEnabled: data.enabled };
  });
}

export async function openRecruitment(
  ctx: ServiceContext,
  input: z.input<typeof openRecruitmentSchema>,
): Promise<TrialSummaryView> {
  const data = parseInput(openRecruitmentSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertTrialsEnabled(ctx);
  assertFuture(ctx, data.recruitmentClosesAt, 'recruitmentClosesAt');
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertTransition(trial, 'recruiting', 'open recruitment');
    // The brief stays sealed, so the public summary is all the recruitment card shows.
    if (trial.summary.length < LIMITS.summaryMin)
      throw new ValidationError('Add a public summary before opening recruitment.', [
        { path: 'summary', message: `at least ${LIMITS.summaryMin} characters` },
      ]);
    const recruitmentClosesAt = data.recruitmentClosesAt ?? trial.recruitmentClosesAt;
    assertFuture(t, recruitmentClosesAt, 'recruitmentClosesAt');
    assertScheduleOrder(recruitmentClosesAt, trial.scheduledStartAt);
    const [updated] = await t.db
      .update(trials)
      .set({ status: 'recruiting', recruitmentClosesAt })
      .where(eq(trials.id, trial.id))
      .returning();
    await recordAudit(t, {
      action: 'trial.recruitment_opened',
      targetType: 'trial',
      targetId: trial.id,
      context: { recruitmentClosesAt: recruitmentClosesAt?.toISOString() ?? null },
    });
    await publishEvent(t, {
      type: 'trial.recruiting',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: {
        ref: trialRef(trial),
        title: trial.title,
        category: trial.category,
        recruitmentClosesAt: recruitmentClosesAt?.toISOString() ?? null,
      },
    });
    await enqueueAnnouncement(t, trial.id, ANNOUNCE_PHASE.open);
    if (recruitmentClosesAt)
      await enqueueAnnouncement(t, trial.id, ANNOUNCE_PHASE.closes, recruitmentClosesAt);
    return toSummaryView(updated!, t.clock.now());
  });
}

export async function cancelTrial(
  ctx: ServiceContext,
  input: z.input<typeof cancelTrialSchema>,
): Promise<TrialSummaryView> {
  const data = parseInput(cancelTrialSchema, input);
  await authorize(ctx, 'canManageTrials', { type: 'trial', id: data.trialId });
  await assertNoConflictOfInterest(ctx, data.trialId, 'cancel it');
  const settings = await getSettings(ctx, 'trials');
  return withTransaction(ctx, async (t) => {
    const trial = await loadTrial(t, data.trialId, 'update');
    assertTransition(trial, 'cancelled', 'cancel');
    const now = t.clock.now();
    const [updated] = await t.db
      .update(trials)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: data.reason })
      .where(eq(trials.id, trial.id))
      .returning();
    if (trial.deadlineAt)
      await cancelDeadlineJobs(t, trial.id, trial.deadlineAt, settings.deadlineWarningsMinutes);
    if (trial.scheduledStartAt) await cancelAutoStart(t, trial.id, trial.scheduledStartAt);
    const stakeholders = await loadParticipantDetails(t, trial.id, STAKE_STATUSES);
    await notifyEach(t, stakeholders, 'trial.update', (p) => ({
      ...notices.cancelled(trial, data.reason),
      dedupeKey: dedupeKeys.notifyCancelled(trial.id, p.memberId),
      data: { trialId: trial.id },
    }));
    await recordAudit(t, {
      action: 'trial.cancelled',
      targetType: 'trial',
      targetId: trial.id,
      context: { from: trial.status, reason: data.reason, stakeholders: stakeholders.length },
    });
    await publishEvent(t, {
      type: 'trial.cancelled',
      aggregateType: 'trial',
      aggregateId: trial.id,
      payload: { ref: trialRef(trial), from: trial.status },
    });
    if (trial.status !== 'draft') await enqueueAnnouncement(t, trial.id, ANNOUNCE_PHASE.final);
    if ((await loadTeams(t, trial.id)).length > 0) await enqueueArchive(t, trial.id);
    return toSummaryView(updated!, now);
  });
}
