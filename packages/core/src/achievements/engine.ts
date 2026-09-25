import { and, count, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';
import { domainEvents, memberAchievements, members } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { NotFoundError } from '../kernel/errors';
import type { DomainEventRecord, EventSubscriber } from '../events/bus';
import { enqueueJob } from '../jobs/queue';
import { type JobHandler, PermanentJobError } from '../jobs/worker';
import { ACHIEVEMENT_EVENT_TYPES, thresholdsMet } from './criteria';
import { grantAchievement } from './grant';
import {
  ACHIEVEMENT_EVALUATE_JOB,
  activeRulesForEvent,
  asEventCountDefinition,
  type AwardableMember,
  type EventCountDefinition,
  loadAwardableMember,
  loadDefinition,
  lockCurrentRule,
  sameRule,
} from './store';

/**
 * The rule engine. Every eligible domain event about a member re-counts that
 * member's events of the same type and awards each active event_count rule
 * whose threshold is met.
 *
 * Idempotency: counting is over the whole event history (not +1 per
 * delivery), and the award insert is guarded by the partial unique index, so
 * duplicate or concurrent deliveries of the same event award at most once.
 *
 * Rules are read fresh for every event and re-read under a share lock inside
 * each award transaction, so an award always follows the rule as it stands
 * (see store.ts: activeRulesForEvent, lockCurrentRule).
 *
 * Revocation is sticky: once an award was revoked, the engine never awards
 * that definition to that member again. Only a manual staff award restores it.
 */

export const ACHIEVEMENT_ENGINE_SUBSCRIBER = 'achievements.engine';

/** Members processed per evaluation run; the job re-queues itself for the rest. */
export const EVALUATION_BATCH_SIZE = 200;

/** Definitions (from `candidates`) the member has never held, revoked awards included. */
async function unheldDefinitions(
  ctx: ServiceContext,
  memberId: string,
  candidates: readonly EventCountDefinition[],
): Promise<EventCountDefinition[]> {
  const history = await ctx.db
    .select({ key: memberAchievements.achievementKey })
    .from(memberAchievements)
    .where(
      and(
        eq(memberAchievements.memberId, memberId),
        inArray(
          memberAchievements.achievementKey,
          candidates.map((definition) => definition.key),
        ),
      ),
    );
  const held = new Set(history.map((row) => row.key));
  return candidates.filter((definition) => !held.has(definition.key));
}

async function countMemberEvents(
  ctx: ServiceContext,
  memberId: string,
  type: string,
): Promise<number> {
  const [row] = await ctx.db
    .select({ value: count() })
    .from(domainEvents)
    .where(and(eq(domainEvents.type, type), eq(domainEvents.subjectMemberId, memberId)));
  return row?.value ?? 0;
}

export interface EvaluationResult {
  awarded: string[];
}

/**
 * Award `candidate` for a delivered event if the rule, re-read under lock,
 * still counts this event type and its (possibly edited) threshold is met.
 */
async function awardForEvent(
  ctx: ServiceContext,
  member: AwardableMember,
  candidate: EventCountDefinition,
  event: DomainEventRecord,
  total: number,
): Promise<boolean> {
  const award = await withTransaction(ctx, async (tx) => {
    const current = await lockCurrentRule(tx, candidate.key);
    if (current?.criteria.event !== event.type) return null;
    if (thresholdsMet([current], total).length === 0) return null;
    return grantAchievement(tx, {
      member,
      definition: current,
      source: 'engine',
      sourceEventId: event.id,
      announce: true,
    });
  });
  return award !== null;
}

/** Evaluate one delivered event. Safe to call any number of times for the same event. */
export async function evaluateEventForAchievements(
  ctx: ServiceContext,
  event: DomainEventRecord,
): Promise<EvaluationResult> {
  const awarded: string[] = [];
  if (!event.subjectMemberId) return { awarded };
  const rules = await activeRulesForEvent(ctx, event.type);
  if (rules.length === 0) return { awarded };
  const member = await loadAwardableMember(ctx, event.subjectMemberId);
  if (!member) return { awarded };
  const open = await unheldDefinitions(ctx, member.id, rules);
  if (open.length === 0) return { awarded };
  const total = await countMemberEvents(ctx, member.id, event.type);
  for (const candidate of thresholdsMet(open, total)) {
    if (await awardForEvent(ctx, member, candidate, event, total)) awarded.push(candidate.key);
  }
  return { awarded };
}

export const achievementEngineSubscriber: EventSubscriber = {
  name: ACHIEVEMENT_ENGINE_SUBSCRIBER,
  types: ACHIEVEMENT_EVENT_TYPES,
  handle: async (ctx, event) => {
    await evaluateEventForAchievements(ctx, event);
  },
};

/**
 * Members who meet a rule but have never held it, excluding deleted and
 * banned members (so a batch never refills with members that are skipped).
 */
async function qualifyingMembers(
  ctx: ServiceContext,
  definition: EventCountDefinition,
): Promise<string[]> {
  const rows = await ctx.db
    .select({ memberId: members.id })
    .from(domainEvents)
    .innerJoin(members, eq(members.id, domainEvents.subjectMemberId))
    .where(
      and(
        eq(domainEvents.type, definition.criteria.event),
        isNull(members.deletedAt),
        ne(members.standing, 'banned'),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(memberAchievements)
            .where(
              and(
                eq(memberAchievements.memberId, members.id),
                eq(memberAchievements.achievementKey, definition.key),
              ),
            ),
        ),
      ),
    )
    .groupBy(members.id)
    .having(sql`count(*) >= ${definition.criteria.threshold}`)
    .orderBy(members.id)
    .limit(EVALUATION_BATCH_SIZE);
  return rows.map((row) => row.memberId);
}

type BackfillOutcome = 'awarded' | 'held' | 'superseded';

/**
 * Backfill one member under lock. 'superseded' means the rule was edited,
 * deactivated or deleted since the evaluation started: the edit queued its
 * own evaluation (or none is due), so this one must stop.
 */
async function backfillMember(
  ctx: ServiceContext,
  member: AwardableMember,
  definition: EventCountDefinition,
): Promise<BackfillOutcome> {
  return withTransaction(ctx, async (tx) => {
    const current = await lockCurrentRule(tx, definition.key);
    if (!current || !sameRule(current, definition)) return 'superseded';
    const award = await grantAchievement(tx, {
      member,
      definition: current,
      source: 'backfill',
      announce: false,
    });
    return award ? 'awarded' : 'held';
  });
}

/**
 * `achievements.evaluate_definition` — retroactive evaluation after a rule is
 * created, re-activated or changed. Backfilled awards notify the member but
 * are not announced publicly (a new rule must not flood the channel).
 */
export const evaluateDefinitionJob: JobHandler = async (ctx, payload, job) => {
  const key = typeof payload.key === 'string' ? payload.key : null;
  if (!key) throw new PermanentJobError('key missing');
  const stored = await loadDefinition(ctx, key).catch((error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });
  const definition = stored ? asEventCountDefinition(stored) : null;
  if (!definition?.active) return { skipped: 'not an active event_count rule' };
  const candidates = await qualifyingMembers(ctx, definition);
  let awarded = 0;
  for (const memberId of candidates) {
    const member = await loadAwardableMember(ctx, memberId);
    if (!member) continue;
    const outcome = await backfillMember(ctx, member, definition);
    if (outcome === 'superseded') return { awarded, superseded: true };
    if (outcome === 'awarded') awarded++;
  }
  const continued = candidates.length === EVALUATION_BATCH_SIZE;
  if (continued) {
    await enqueueJob(
      ctx,
      ACHIEVEMENT_EVALUATE_JOB,
      { key },
      { dedupeKey: `achievements:evaluate:${key}:after:${job.id}` },
    );
  }
  return { awarded, continued };
};
