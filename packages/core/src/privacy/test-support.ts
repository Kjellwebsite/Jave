import { getTableColumns, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { sessions } from '@jave/database';
import * as schema from '@jave/database/schema';
import {
  getOrCreateDraft,
  submitApplication,
  updateDraft,
} from '../applications/applicant.service';
import { decideApplication } from '../applications/decision.service';
import { reviewApplication, startReview } from '../applications/review.service';
import { claimRank, setEvaluatorNotes } from '../identity/capabilities.service';
import { addMemberNote, completeOnboarding, updateProfile } from '../identity/profile.service';
import { recordGuildLeave, resolveUserActor } from '../identity/users.service';
import { linkGithubAccount } from '../integrations/external-accounts.service';
import type { JobHandlerMap } from '../jobs/worker';
import { sha256Hex } from '../kernel/crypto';
import { createMission, publishMission, selfAssignMission, submitMission } from '../missions';
import { VALID_BRIEF } from '../missions/testing/fixtures';
import { warnMember } from '../moderation/cases.service';
import type { UserActor } from '../permissions/actor';
import { createProject, recordContribution } from '../projects';
import { coreJobHandlers } from '../registry';
import { updateSettings } from '../settings/settings.service';
import type { TestKit } from '../testing';
import { addInternalNote, recordMessage } from '../tickets/messages.service';
import {
  authorOf,
  botContext,
  nextSnowflake,
  openAs,
  provisionThread,
} from '../tickets/test-fixtures';

/**
 * TEST-ONLY. A member ("Nova Quill") who has used most of JAVE: onboarding,
 * an application with reviews, a rank claim with evidence, staff and
 * evaluator notes, a ticket conversation with an internal note, a linked
 * GitHub account, a warning, a mission submission, a project contribution,
 * notifications and a dashboard session. Everything Nova wrote carries a
 * `QZ-` marker so a scan can prove it was erased; staff text names her.
 */

export const NOVA = {
  username: 'novaquill',
  displayName: 'Nova Quill',
  github: 'nq-builds',
} as const;

/** Every marker starts with this; nothing else in the fixtures does. */
export const MARKER_PREFIX = 'QZ-';

export interface Footprint {
  nova: UserActor;
  founder: UserActor;
  core: UserActor;
  ops: UserActor;
  mod: UserActor;
  teammate: UserActor;
  ticketId: string;
  applicationId: string;
}

export async function buildFootprint(kit: TestKit): Promise<Footprint> {
  const handlers: JobHandlerMap = coreJobHandlers();
  const founder = await kit.member({ roles: ['founder'], username: 'founder' });
  const core = await kit.member({ roles: ['core'], username: 'corelead' });
  const ops = await kit.member({ roles: ['operations'], username: 'opslead' });
  const mod = await kit.member({ roles: ['moderator'], username: 'modlead' });
  const teammate = await kit.member({ roles: ['member'], username: 'orbitmate' });
  await updateSettings(kit.system, 'channels', {
    tickets: '300000000000000001',
    ticketArchive: '300000000000000002',
    applicationsReview: '300000000000000003',
  });

  let nova = await kit.member({ username: NOVA.username });
  await completeOnboarding(kit.as(nova), {
    displayName: NOVA.displayName,
    headline: 'QZ-HEADLINE systems builder',
    primaryDomain: 'create',
  });
  await updateProfile(kit.as(nova), nova.memberId!, { bio: 'QZ-BIO I build tools for schools.' });
  await updateProfile(kit.as(teammate), teammate.memberId!, {
    bio: 'TEAMMATE-BIO private to members',
    profileVisibility: 'staff',
  });
  nova = await resolveUserActor(kit.system, nova.userId);

  const { application } = await getOrCreateDraft(kit.as(nova));
  await updateDraft(kit.as(nova), {
    domainKey: 'create',
    motivation: 'QZ-MOTIVATION I want to ship with people who hold a higher bar.',
    experience: 'QZ-EXPERIENCE three years of web apps.',
    projects: 'QZ-PROJECTS an open-source scheduler.',
    portfolioUrl: 'https://example.com/qz-portfolio',
    evidenceLinks: ['https://github.com/example/qz-evidence'],
    references: 'QZ-REFERENCES Jane Doe — jane@example.com',
  });
  await submitApplication(kit.as(nova));
  await startReview(kit.as(core), { applicationId: application.id });
  await reviewApplication(kit.as(core), {
    applicationId: application.id,
    recommendation: 'accept',
    score: 5,
    note: `${NOVA.displayName} has strong references.`,
  });
  await decideApplication(kit.as(core), {
    applicationId: application.id,
    decision: 'accept',
    reason: `${NOVA.displayName} checks out.`,
    applicantMessage: `Welcome, ${NOVA.displayName}.`,
  });
  nova = await resolveUserActor(kit.system, nova.userId);

  await claimRank(kit.as(nova), {
    facetKey: 'create.technical',
    rank: 'B',
    evidence: {
      title: 'QZ-EVIDENCE scheduler',
      url: 'https://example.com/qz-evidence-url',
      description: 'QZ-EVIDENCE-DESC used by two schools',
    },
  });
  await addMemberNote(kit.as(core), nova.memberId!, `${NOVA.displayName} is reliable.`);
  await setEvaluatorNotes(kit.as(core), {
    memberId: nova.memberId!,
    facetKey: 'create.technical',
    notes: `${NOVA.displayName} writes clean code.`,
  });
  await linkGithubAccount(kit.as(nova), { username: NOVA.github });

  const ticket = await openAs(kit, nova, {
    category: 'general',
    subject: 'QZ-SUBJECT build server access',
    body: 'QZ-TICKETBODY my team needs the staging server.',
  });
  const threadId = await provisionThread(kit, ticket.id);
  await recordMessage(botContext(kit), {
    threadId,
    discordMessageId: nextSnowflake(),
    author: authorOf(nova),
    body: 'QZ-THREADMSG here are the details.',
  });
  await recordMessage(botContext(kit), {
    threadId,
    discordMessageId: nextSnowflake(),
    author: authorOf(mod),
    body: `Done, ${NOVA.displayName}.`,
  });
  await addInternalNote(kit.as(mod), {
    ticketId: ticket.id,
    body: `Checked ${NOVA.displayName}'s team first.`,
  });

  await warnMember(kit.as(mod), {
    targetUserId: nova.userId,
    reason: `${NOVA.displayName} posted a teammate's email address.`,
  });

  const mission = await createMission(kit.as(ops), {
    title: 'Harden the uploader',
    brief: VALID_BRIEF,
    type: 'build',
  });
  await publishMission(kit.as(ops), { missionId: mission.id });
  const assignment = await selfAssignMission(kit.as(nova), { missionId: mission.id });
  await submitMission(kit.as(nova), {
    assignmentId: assignment.id,
    submission: 'QZ-MISSION resumable uploads, notes in the PR.',
    evidence: {
      title: 'QZ-MISSION-EVIDENCE',
      url: 'https://github.com/example/qz-uploader/pull/3',
    },
  });

  const project = await createProject(kit.as(nova), { title: 'Orbital', visibility: 'public' });
  await recordContribution(kit.as(nova), {
    projectId: project.id,
    kind: 'code',
    title: 'QZ-CONTRIBUTION offline sync engine',
    url: 'https://github.com/example/qz-orbital/pull/7',
  });

  await kit.db.insert(sessions).values({
    userId: nova.userId,
    tokenHash: sha256Hex(`session-${nova.userId}`),
    userAgent: 'QZ-AGENT Firefox',
    expiresAt: new Date(kit.clock.now().getTime() + 86_400_000),
  });

  await kit.drain(handlers);
  return {
    nova,
    founder,
    core,
    ops,
    mod,
    teammate,
    ticketId: ticket.id,
    applicationId: application.id,
  };
}

/** A member who left the server (erasure requires it). */
export async function departed(kit: TestKit, actor: UserActor): Promise<void> {
  await recordGuildLeave(kit.system, actor.discordId);
}

/**
 * Every text, varchar, jsonb and array column of every table holding one of
 * `needles` (case-insensitive), as `table.column` → matching row count.
 * Built from the schema, so new tables are covered without touching tests.
 */
export async function scanForText(
  kit: TestKit,
  needles: readonly string[],
): Promise<Record<string, number>> {
  const hits: Record<string, number> = {};
  const textual = new Set(['PgText', 'PgVarchar', 'PgJsonb', 'PgJson', 'PgArray']);
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const table = getTableName(value);
    for (const column of Object.values(getTableColumns(value))) {
      if (!textual.has(column.columnType)) continue;
      const conditions = needles.map(
        (needle) => sql`${column}::text ilike ${`%${needle.replace(/[\\%_]/g, '\\$&')}%`}`,
      );
      const [row] = (await kit.db
        .select({ n: sql<number>`count(*)::int` })
        .from(value)
        .where(sql.join(conditions, sql` or `))) as { n: number }[];
      if (row && row.n > 0) hits[`${table}.${column.name}`] = row.n;
    }
  }
  return hits;
}
