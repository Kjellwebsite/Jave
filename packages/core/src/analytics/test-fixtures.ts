/**
 * Seeding helpers for analytics tests. The applications/trials/missions/…
 * modules are built in parallel, so fixtures write their tables directly.
 * Test-only: nothing in the domain layer imports this file.
 */
import {
  applications,
  contributions,
  guildMemberEvents,
  missionAssignments,
  missions,
  modCases,
  projects,
  securityEvents,
  tickets,
  trialResults,
  trials,
} from '@jave/database';
import type { TestKit } from '../testing';

type ApplicationStatus = (typeof applications.$inferInsert)['status'];
type TrialStatus = (typeof trials.$inferInsert)['status'];
type TrialOutcome = (typeof trialResults.$inferInsert)['outcome'];
type AssignmentStatus = (typeof missionAssignments.$inferInsert)['status'];
type ProjectStatus = (typeof projects.$inferInsert)['status'];
type ModAction = (typeof modCases.$inferInsert)['action'];
type SecurityTrigger = (typeof securityEvents.$inferInsert)['trigger'];
type TicketStatus = (typeof tickets.$inferInsert)['status'];

export function fixtures(kit: TestKit) {
  let slug = 0;
  return {
    guildEvent: (userId: string, type: 'join' | 'leave', occurredAt: Date) =>
      kit.db.insert(guildMemberEvents).values({ userId, type, occurredAt }),

    application: async (
      userId: string,
      status: ApplicationStatus,
      times: { submittedAt?: Date; decidedAt?: Date } = {},
    ) => {
      await kit.db.insert(applications).values({
        userId,
        status,
        submittedAt: times.submittedAt ?? null,
        decidedAt: times.decidedAt ?? null,
      });
    },

    trial: async (status: TrialStatus, completedAt: Date | null = null) => {
      const [row] = await kit.db
        .insert(trials)
        .values({
          title: 'Fixture trial',
          category: 'build',
          brief: 'Build something real.',
          rubric: [],
          durationMinutes: 120,
          status,
          completedAt,
        })
        .returning({ id: trials.id });
      return row!.id;
    },

    trialResult: (
      trialId: string,
      memberId: string,
      outcome: TrialOutcome,
      publishedAt: Date | null,
    ) => kit.db.insert(trialResults).values({ trialId, memberId, outcome, publishedAt }),

    mission: async (status: 'draft' | 'open' | 'closed' | 'archived') => {
      const [row] = await kit.db
        .insert(missions)
        .values({ title: 'Fixture mission', brief: 'Do it.', type: 'build', status })
        .returning({ id: missions.id });
      return row!.id;
    },

    assignment: (
      missionId: string,
      memberId: string,
      status: AssignmentStatus,
      verifiedAt: Date | null,
    ) => kit.db.insert(missionAssignments).values({ missionId, memberId, status, verifiedAt }),

    project: (
      ownerMemberId: string,
      status: ProjectStatus,
      options: { shippedAt?: Date; deletedAt?: Date } = {},
    ) =>
      kit.db.insert(projects).values({
        slug: `fixture-${++slug}`,
        title: 'Fixture project',
        ownerMemberId,
        status,
        shippedAt: options.shippedAt ?? null,
        deletedAt: options.deletedAt ?? null,
      }),

    contribution: (
      memberId: string,
      status: 'submitted' | 'verified' | 'rejected',
      verifiedAt: Date | null,
    ) =>
      kit.db
        .insert(contributions)
        .values({ memberId, kind: 'code', title: 'Fixture contribution', status, verifiedAt }),

    ticket: (
      openerUserId: string,
      options: {
        createdAt: Date;
        status?: TicketStatus;
        slaDueAt?: Date;
        firstResponseAt?: Date;
        slaBreachedAt?: Date;
      },
    ) =>
      kit.db.insert(tickets).values({
        category: 'general',
        subject: 'Fixture ticket',
        openerUserId,
        status: options.status ?? 'open',
        createdAt: options.createdAt,
        slaFirstResponseDueAt: options.slaDueAt ?? null,
        firstResponseAt: options.firstResponseAt ?? null,
        slaBreachedAt: options.slaBreachedAt ?? null,
      }),

    modCase: (targetUserId: string, action: ModAction, createdAt: Date) =>
      kit.db.insert(modCases).values({ targetUserId, action, reason: 'Fixture.', createdAt }),

    securityEvent: (trigger: SecurityTrigger, createdAt: Date) =>
      kit.db
        .insert(securityEvents)
        .values({ riskScore: 50, trigger, evidence: { signals: [] }, createdAt }),
  };
}
