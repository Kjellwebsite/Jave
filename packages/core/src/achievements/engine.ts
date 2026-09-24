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
  activeEventCountDefinitions,
  asEventCountDefinition,
  type EventCountDefinition,
  loadAwardableMember,
  loadDefinition,
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

/** Evaluate one delivered event. Safe to call any number of times for the same event. */
export async function evaluateEventForAchievements(
  ctx: ServiceContext,
  event: DomainEventRecord,
): Promise<EvaluationResult> {
  const awarded: string[] = [];
  if (!event.subjectMemberId) return { awarded };
  const rules = (await activeEventCountDefinitions(ctx)).filter(
    (definition) => definition.criteria.event === event.type,
  );
  if (rules.length === 0) return { awarded };
  const member = await loadAwardableMember(ctx, event.subjectMemberId);
  if (!member) return { awarded };
  const open = await unheldDefinitions(ctx, member.id, rules);
  if (open.length === 0) return { awarded };
  const total = await countMemberEvents(ctx, member.id, event.type);
  for (const definition of thresholdsMet(open, total)) {
    const award = await withTransaction(ctx, (tx) =>
      grantAchievement(tx, {
        member,
        definition,
        source: 'engine',
        sourceEventId: event.id,
        announce: true,
      }),
    );
    if (award) awarded.push(definition.key);
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
    const award = await withTransaction(ctx, (tx) =>
      grantAchievement(tx, { member, definition, source: 'backfill', announce: false }),
    );
    if (award) awarded++;
  }
  if (candidates.length === EVALUATION_BATCH_SIZE) {
    await enqueueJob(
      ctx,
      ACHIEVEMENT_EVALUATE_JOB,
      { key },
      { dedupeKey: `achievements:evaluate:${key}:after:${job.id}` },
    );
  }
  return { awarded, continued: candidates.length === EVALUATION_BATCH_SIZE };
};
