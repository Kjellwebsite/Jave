import { eq } from 'drizzle-orm';
import { domainEvents, jobs, notifications } from '@jave/database';
import type { TestKit } from '../../testing';
import { createEventHandlers } from '../../events/bus';
import type { DomainEventType } from '../../events/catalog';
import { enqueueJob } from '../../jobs/queue';
import type { UserActor } from '../../permissions/actor';
import * as achievements from '../../achievements';
import { jobHandlers } from '../index';
import { createMission, publishMission } from '../missions.service';
import type { createMissionSchema } from '../schemas';
import type { z } from 'zod';

export { DATABASE_SUITE_TIMEOUTS } from '../../achievements/testing/fixtures';

/** Mission + achievement job handlers, with the achievement engine subscribed. */
export const missionTestHandlers = {
  ...jobHandlers,
  ...achievements.jobHandlers,
  ...createEventHandlers(achievements.subscribers),
};

export const VALID_BRIEF = 'Ship a working prototype and document what you learned.';

export async function openMission(
  kit: TestKit,
  staff: UserActor,
  overrides: Partial<z.input<typeof createMissionSchema>> = {},
) {
  const draft = await createMission(kit.as(staff), {
    title: 'Prototype sprint',
    brief: VALID_BRIEF,
    type: 'build',
    evidenceRequired: false,
    ...overrides,
  });
  const { mission } = await publishMission(kit.as(staff), { missionId: draft.id, announce: false });
  return mission;
}

/** Run a job type once, now, through the real worker. */
export async function runJob(kit: TestKit, type: string) {
  await enqueueJob(kit.system, type, {});
  return kit.drain(missionTestHandlers);
}

export async function eventsOfType(kit: TestKit, type: DomainEventType) {
  return kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));
}

export async function jobsOfType(kit: TestKit, type: string) {
  return kit.db.select().from(jobs).where(eq(jobs.type, type));
}

export async function inboxOf(kit: TestKit, actor: UserActor) {
  return kit.db.select().from(notifications).where(eq(notifications.recipientUserId, actor.userId));
}

export const EVIDENCE = { title: 'Prototype repository', url: 'https://example.com/repo' };
