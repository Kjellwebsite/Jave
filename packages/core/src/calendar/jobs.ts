import { and, asc, inArray, lt } from 'drizzle-orm';
import { events } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import type { JobHandler, JobHandlerMap, RecurringJob } from '../jobs/worker';
import {
  AUTO_COMPLETE_GRACE_MS,
  CALENDAR_REMINDER_JOB,
  CALENDAR_SWEEP_EVERY_MS,
  CALENDAR_SWEEP_JOB,
  SWEEP_BATCH_LIMIT,
} from './constants';
import { completeEventInTx } from './events.service';
import { requireSystemActor } from './guards';
import { loadEvent, OPEN_EVENT_STATUSES } from './records';
import { reminderJobHandler } from './reminders';

/**
 * Complete events nobody closed: scheduled or live events more than 12 h
 * past their end. Keeps listings and history truthful without staff action.
 */
export async function sweepStaleEvents(ctx: ServiceContext): Promise<number> {
  requireSystemActor(ctx);
  const cutoff = new Date(ctx.clock.now().getTime() - AUTO_COMPLETE_GRACE_MS);
  const stale = await ctx.db
    .select({ id: events.id })
    .from(events)
    .where(and(inArray(events.status, [...OPEN_EVENT_STATUSES]), lt(events.endsAt, cutoff)))
    .orderBy(asc(events.endsAt))
    .limit(SWEEP_BATCH_LIMIT);
  let completed = 0;
  for (const { id } of stale) {
    const done = await withTransaction(ctx, async (tx) => {
      const event = await loadEvent(tx, id, { lock: true });
      if (!OPEN_EVENT_STATUSES.includes(event.status) || event.endsAt >= cutoff) return false;
      await completeEventInTx(tx, event, 'sweep');
      return true;
    });
    if (done) completed++;
  }
  return completed;
}

const sweepJobHandler: JobHandler = async (ctx) => ({ completed: await sweepStaleEvents(ctx) });

export const calendarJobHandlers: JobHandlerMap = {
  [CALENDAR_REMINDER_JOB]: reminderJobHandler,
  [CALENDAR_SWEEP_JOB]: sweepJobHandler,
};

export const calendarRecurringJobs: readonly RecurringJob[] = [
  { type: CALENDAR_SWEEP_JOB, everyMs: CALENDAR_SWEEP_EVERY_MS },
];
