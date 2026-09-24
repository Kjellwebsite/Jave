import { eq } from 'drizzle-orm';
import { domainEvents } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { actorUserId } from '../permissions/actor';
import { enqueueJob } from '../jobs/queue';
import { type JobHandlerMap, PermanentJobError } from '../jobs/worker';
import type { DomainEventType } from './catalog';

export type DomainEventRecord = typeof domainEvents.$inferSelect;

export interface DomainEventInput {
  type: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  /** The member this event is about; drives achievements and member activity. */
  subjectMemberId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Transactional outbox: the event row and its dispatch job commit (or roll
 * back) together with the state change that caused them.
 */
export async function publishEvent(ctx: ServiceContext, input: DomainEventInput): Promise<number> {
  const [row] = await ctx.db
    .insert(domainEvents)
    .values({
      type: input.type,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      subjectMemberId: input.subjectMemberId ?? null,
      actorUserId: actorUserId(ctx.actor),
      payload: input.payload ?? {},
      occurredAt: ctx.clock.now(),
    })
    .returning({ id: domainEvents.id });
  const id = row!.id;
  await enqueueJob(ctx, EVENT_DISPATCH_JOB, { eventId: id }, { maxAttempts: 10 });
  return id;
}

export interface EventSubscriber {
  /** Stable name; part of the delivery job's dedupe key. */
  name: string;
  types: readonly DomainEventType[] | '*';
  handle: (ctx: ServiceContext, event: DomainEventRecord) => Promise<void>;
}

export const EVENT_DISPATCH_JOB = 'events.dispatch';
export const EVENT_DELIVER_JOB = 'events.deliver';

function matches(subscriber: EventSubscriber, type: string): boolean {
  return subscriber.types === '*' || (subscriber.types as readonly string[]).includes(type);
}

async function loadEvent(ctx: ServiceContext, eventId: unknown): Promise<DomainEventRecord> {
  if (typeof eventId !== 'number') throw new PermanentJobError('eventId missing');
  const [event] = await ctx.db.select().from(domainEvents).where(eq(domainEvents.id, eventId));
  if (!event) throw new PermanentJobError(`event ${eventId} not found`);
  return event;
}

/**
 * Two-hop dispatch: `events.dispatch` fans out one `events.deliver` job per
 * matching subscriber, so a failing subscriber retries in isolation.
 * Subscribers must be idempotent (deliveries are at-least-once).
 */
export function createEventHandlers(subscribers: readonly EventSubscriber[]): JobHandlerMap {
  const byName = new Map(subscribers.map((s) => [s.name, s]));
  return {
    [EVENT_DISPATCH_JOB]: async (ctx, payload) => {
      const event = await loadEvent(ctx, payload.eventId);
      const targets = subscribers.filter((s) => matches(s, event.type));
      for (const subscriber of targets) {
        await enqueueJob(
          ctx,
          EVENT_DELIVER_JOB,
          { eventId: event.id, subscriber: subscriber.name },
          { dedupeKey: `event:${event.id}:${subscriber.name}`, maxAttempts: 8 },
        );
      }
      return { subscribers: targets.map((s) => s.name) };
    },
    [EVENT_DELIVER_JOB]: async (ctx, payload) => {
      const subscriber = byName.get(String(payload.subscriber));
      if (!subscriber)
        throw new PermanentJobError(`unknown subscriber ${String(payload.subscriber)}`);
      const event = await loadEvent(ctx, payload.eventId);
      await subscriber.handle(ctx, event);
    },
  };
}
