import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  adversarialEvaluations,
  adversarialObservations,
  adversarialRoles,
  aiActionProposals,
  applicationReviews,
  applications,
  applicationStatusChanges,
  auditLogs,
  contributions,
  domainEvents,
  evidence,
  externalAccounts,
  jobs,
  memberAchievements,
  memberCapabilities,
  memberNotes,
  memberRoles,
  members,
  missionAssignments,
  modCases,
  notificationPreferences,
  notifications,
  projectMembers,
  rankHistory,
  rateLimitBuckets,
  referralCodes,
  referrals,
  securityEvents,
  sessions,
  ticketEvents,
  ticketMessages,
  tickets,
  trialEvaluations,
  trialParticipants,
  userPreferences,
  users,
  verifications,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { randomCode } from '../kernel/crypto';
import {
  ERASED_DISPLAY_NAME,
  ERASED_HANDLE_PREFIX,
  ERASED_HANDLE_RANDOM_LENGTH,
  ERASED_MARKER,
  ERASED_USERNAME,
  SCRUB_BATCH_SIZE,
} from './constants';
import { likePatterns, scrubJson, scrubText } from './scrub';

/**
 * The individual erasure operations, each returning how many rows it
 * changed. They run inside the erasure transaction, in order. Every choice
 * of erase / delete / keep is listed in docs/modules/privacy.md.
 */

export interface ErasureTarget {
  userId: string;
  memberId: string;
  actorUserId: string;
  /**
   * Ids of records that belong to the person (applications, tickets, cases…):
   * audit entries and domain events about those records concern them too.
   */
  relatedIds: readonly string[];
}

/** Strings to replace in kept records, and what replaces them. */
export interface ScrubRule {
  terms: readonly string[];
  replacement: string;
}

/** Ids of the person's own records, for scoping audit and event scrubs. */
export async function relatedRecordIds(
  tx: Tx,
  ids: { userId: string; memberId: string },
): Promise<string[]> {
  const lists = await Promise.all([
    tx.db
      .select({ id: applications.id })
      .from(applications)
      .where(eq(applications.userId, ids.userId)),
    tx.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.openerUserId, ids.userId)),
    tx.db
      .select({ id: verifications.id })
      .from(verifications)
      .where(eq(verifications.subjectMemberId, ids.memberId)),
    tx.db.select({ id: modCases.id }).from(modCases).where(eq(modCases.targetUserId, ids.userId)),
    tx.db.select({ id: evidence.id }).from(evidence).where(eq(evidence.memberId, ids.memberId)),
    tx.db
      .select({ id: contributions.id })
      .from(contributions)
      .where(eq(contributions.memberId, ids.memberId)),
    tx.db
      .select({ id: missionAssignments.id })
      .from(missionAssignments)
      .where(eq(missionAssignments.memberId, ids.memberId)),
    tx.db
      .select({ id: securityEvents.id })
      .from(securityEvents)
      .where(eq(securityEvents.userId, ids.userId)),
    // Records other people act on about her: a mission review, a trial and its
    // team, a referral decision, a project departure.
    tx.db
      .selectDistinct({ id: missionAssignments.missionId })
      .from(missionAssignments)
      .where(eq(missionAssignments.memberId, ids.memberId)),
    tx.db
      .selectDistinct({ id: trialParticipants.trialId })
      .from(trialParticipants)
      .where(eq(trialParticipants.memberId, ids.memberId)),
    tx.db
      .select({ id: referrals.id })
      .from(referrals)
      .where(or(eq(referrals.inviterUserId, ids.userId), eq(referrals.inviteeUserId, ids.userId))),
    tx.db
      .selectDistinct({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.memberId, ids.memberId)),
  ]);
  const teams = await tx.db
    .select({ id: trialParticipants.teamId })
    .from(trialParticipants)
    .where(and(eq(trialParticipants.memberId, ids.memberId), isNotNull(trialParticipants.teamId)));
  return [
    ids.userId,
    ids.memberId,
    ...lists.flat().map((row) => row.id),
    ...teams.map((row) => row.id!),
  ];
}

/** Subjects of the person's tickets: they also name threads and appear in queued jobs. */
export async function authoredTitles(tx: Tx, userId: string): Promise<string[]> {
  const rows = await tx.db
    .select({ subject: tickets.subject })
    .from(tickets)
    .where(eq(tickets.openerUserId, userId));
  return rows.map((row) => row.subject);
}

export type ErasureCounts = Record<string, number>;

type Tx = ServiceContext;

async function changed(query: Promise<unknown[]>): Promise<number> {
  return (await query).length;
}

/** The account and profile: identity fields go, the rows stay (they anchor kept records). */
export async function eraseIdentity(tx: Tx, target: ErasureTarget): Promise<ErasureCounts> {
  const now = tx.clock.now();
  await tx.db
    .update(users)
    .set({ username: ERASED_USERNAME, displayName: null, avatarHash: null, deletedAt: now })
    .where(eq(users.id, target.userId));
  await tx.db
    .update(members)
    .set({
      handle: `${ERASED_HANDLE_PREFIX}${randomCode(ERASED_HANDLE_RANDOM_LENGTH).toLowerCase()}`,
      displayName: ERASED_DISPLAY_NAME,
      headline: null,
      bio: null,
      primaryDomain: null,
      profileVisibility: 'staff',
      showClaimsPublicly: false,
      showOnLeaderboards: false,
      deletedAt: now,
    })
    .where(eq(members.id, target.memberId));
  const roles = await changed(
    tx.db
      .update(memberRoles)
      .set({ revokedAt: now, revokedByUserId: target.actorUserId })
      .where(and(eq(memberRoles.memberId, target.memberId), isNull(memberRoles.revokedAt)))
      .returning({ id: memberRoles.id }),
  );
  return { rolesRevoked: roles };
}

/** Rows that exist only for the person: gone. */
export async function deletePersonalRows(tx: Tx, target: ErasureTarget): Promise<ErasureCounts> {
  const { userId, memberId } = target;
  return {
    sessions: await changed(
      tx.db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id }),
    ),
    preferences: await changed(
      tx.db
        .delete(userPreferences)
        .where(eq(userPreferences.userId, userId))
        .returning({ id: userPreferences.userId }),
    ),
    notificationPreferences: await changed(
      tx.db
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .returning({ id: notificationPreferences.userId }),
    ),
    // Deliveries cascade.
    notifications: await changed(
      tx.db
        .delete(notifications)
        .where(eq(notifications.recipientUserId, userId))
        .returning({ id: notifications.id }),
    ),
    linkedAccounts: await changed(
      tx.db
        .delete(externalAccounts)
        .where(eq(externalAccounts.memberId, memberId))
        .returning({ id: externalAccounts.id }),
    ),
    rateLimitBuckets: await changed(
      tx.db
        .delete(rateLimitBuckets)
        .where(like(rateLimitBuckets.key, `%${userId}%`))
        .returning({ key: rateLimitBuckets.key }),
    ),
  };
}

/** What the member wrote about themselves: replaced, while the records it belongs to stay. */
export async function eraseAuthoredText(tx: Tx, target: ErasureTarget): Promise<ErasureCounts> {
  const { userId, memberId } = target;
  const now = tx.clock.now();
  const openedTickets = tx.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.openerUserId, userId));
  return {
    evidence: await changed(
      tx.db
        .update(evidence)
        .set({ title: ERASED_MARKER, url: null, description: null, deletedAt: now })
        .where(eq(evidence.memberId, memberId))
        .returning({ id: evidence.id }),
    ),
    applications: await changed(
      tx.db
        .update(applications)
        .set({
          experience: null,
          projects: null,
          portfolioUrl: null,
          motivation: null,
          references: null,
          evidenceLinks: [],
          applicantMessage: null,
        })
        .where(eq(applications.userId, userId))
        .returning({ id: applications.id }),
    ),
    verificationClaims: await changed(
      tx.db
        .update(verifications)
        .set({ claim: ERASED_MARKER })
        .where(eq(verifications.subjectMemberId, memberId))
        .returning({ id: verifications.id }),
    ),
    trialStatements: await changed(
      tx.db
        .update(trialParticipants)
        .set({ statement: null })
        .where(eq(trialParticipants.memberId, memberId))
        .returning({ id: trialParticipants.id }),
    ),
    missionSubmissions: await changed(
      tx.db
        .update(missionAssignments)
        .set({ submission: null, submissionEvidenceTitle: null, submissionEvidenceUrl: null })
        .where(eq(missionAssignments.memberId, memberId))
        .returning({ id: missionAssignments.id }),
    ),
    contributions: await changed(
      tx.db
        .update(contributions)
        .set({ title: ERASED_MARKER, description: null, url: null, externalRef: null })
        .where(eq(contributions.memberId, memberId))
        .returning({ id: contributions.id }),
    ),
    tickets: await changed(
      tx.db
        .update(tickets)
        .set({ subject: ERASED_MARKER, aiSummary: null })
        .where(eq(tickets.openerUserId, userId))
        .returning({ id: tickets.id }),
    ),
    ticketMessages: await changed(
      tx.db
        .update(ticketMessages)
        .set({ body: ERASED_MARKER, originalBody: null, attachments: [] })
        .where(eq(ticketMessages.authorUserId, userId))
        .returning({ id: ticketMessages.id }),
    ),
    // Everything else in the member's own tickets (staff replies, internal notes) is about them.
    ticketConversations: await changed(
      tx.db
        .update(ticketMessages)
        .set({ body: ERASED_MARKER, originalBody: null, attachments: [] })
        .where(inArray(ticketMessages.ticketId, openedTickets))
        .returning({ id: ticketMessages.id }),
    ),
    staffNotes: await changed(
      tx.db
        .update(memberNotes)
        .set({ body: ERASED_MARKER, deletedAt: now })
        .where(eq(memberNotes.memberId, memberId))
        .returning({ id: memberNotes.id }),
    ),
    evaluatorNotes: await changed(
      tx.db
        .update(memberCapabilities)
        .set({ notes: null })
        .where(eq(memberCapabilities.memberId, memberId))
        .returning({ id: memberCapabilities.id }),
    ),
    // Message excerpts are the member's words; the signals and scores stay.
    securityExcerpts: await changed(
      tx.db
        .update(securityEvents)
        .set({ evidence: sql`${securityEvents.evidence} - 'excerpt'` })
        .where(eq(securityEvents.userId, userId))
        .returning({ id: securityEvents.id }),
    ),
    referralCodes: await changed(
      tx.db
        .update(referralCodes)
        .set({ active: false, deactivatedAt: now })
        .where(and(eq(referralCodes.ownerUserId, userId), eq(referralCodes.active, true)))
        .returning({ code: referralCodes.code }),
    ),
    aiProposals: await changed(
      tx.db
        .update(aiActionProposals)
        .set({
          preview: ERASED_MARKER,
          payload: {},
          status: sql`case when ${aiActionProposals.status} = 'pending' then 'expired'::ai_proposal_status else ${aiActionProposals.status} end`,
        })
        .where(eq(aiActionProposals.requestedByUserId, userId))
        .returning({ id: aiActionProposals.id }),
    ),
  };
}

interface ScrubTarget {
  name: string;
  table: PgTable;
  id: AnyPgColumn;
  column: AnyPgColumn;
  json: boolean;
  /** Rows that can concern the person; null scans the whole table. */
  scope: (target: ErasureTarget) => SQL | undefined;
}

const byMember = (column: AnyPgColumn) => (t: ErasureTarget) => eq(column, t.memberId);
const byUser = (column: AnyPgColumn) => (t: ErasureTarget) => eq(column, t.userId);
const ofApplications = (column: AnyPgColumn) => (t: ErasureTarget) =>
  inArray(
    column,
    sql`(select ${applications.id} from ${applications} where ${applications.userId} = ${t.userId})`,
  );

/** Trials she took part in (any participant record). */
const herTrials = (t: ErasureTarget) =>
  sql`(select ${trialParticipants.trialId} from ${trialParticipants} where ${trialParticipants.memberId} = ${t.memberId})`;
/** Adversarial roles in those trials: she was the operative, on the team, or a participant. */
const herTrialRoles = (t: ErasureTarget) =>
  sql`(select ${adversarialRoles.id} from ${adversarialRoles} where ${adversarialRoles.operativeMemberId} = ${t.memberId} or ${adversarialRoles.trialId} in ${herTrials(t)})`;
const ofHerTrialRoles = (column: AnyPgColumn) => (t: ErasureTarget) =>
  inArray(column, herTrialRoles(t));

/**
 * Kept records that can carry the person's name: other people's
 * notifications, staff-written notes and reasons, audit and event context,
 * queued jobs. Their names are replaced with ERASED_DISPLAY_NAME.
 */
const SCRUB_TARGETS: readonly ScrubTarget[] = [
  {
    name: 'notifications.title',
    table: notifications,
    id: notifications.id,
    column: notifications.title,
    json: false,
    scope: () => undefined,
  },
  {
    name: 'notifications.body',
    table: notifications,
    id: notifications.id,
    column: notifications.body,
    json: false,
    scope: () => undefined,
  },
  {
    name: 'notifications.data',
    table: notifications,
    id: notifications.id,
    column: notifications.data,
    json: true,
    scope: () => undefined,
  },
  {
    name: 'audit_logs.context',
    table: auditLogs,
    id: auditLogs.id,
    column: auditLogs.context,
    json: true,
    scope: (t) =>
      or(
        eq(auditLogs.actorUserId, t.userId),
        inArray(auditLogs.targetId, [...t.relatedIds]),
        sql`${auditLogs.context}::text like ${`%${t.memberId}%`}`,
        sql`${auditLogs.context}::text like ${`%${t.userId}%`}`,
      ),
  },
  {
    name: 'domain_events.payload',
    table: domainEvents,
    id: domainEvents.id,
    column: domainEvents.payload,
    json: true,
    scope: (t) =>
      or(
        eq(domainEvents.subjectMemberId, t.memberId),
        eq(domainEvents.actorUserId, t.userId),
        inArray(domainEvents.aggregateId, [...t.relatedIds]),
      ),
  },
  {
    name: 'ticket_events.data',
    table: ticketEvents,
    id: ticketEvents.id,
    column: ticketEvents.data,
    json: true,
    scope: (t) =>
      inArray(
        ticketEvents.ticketId,
        sql`(select ${tickets.id} from ${tickets} where ${tickets.openerUserId} = ${t.userId})`,
      ),
  },
  {
    name: 'jobs.payload',
    table: jobs,
    id: jobs.id,
    column: jobs.payload,
    json: true,
    scope: () => inArray(jobs.status, ['pending', 'running', 'dead']),
  },
  {
    name: 'mod_cases.reason',
    table: modCases,
    id: modCases.id,
    column: modCases.reason,
    json: false,
    scope: byUser(modCases.targetUserId),
  },
  {
    name: 'mod_cases.revoke_reason',
    table: modCases,
    id: modCases.id,
    column: modCases.revokeReason,
    json: false,
    scope: byUser(modCases.targetUserId),
  },
  {
    name: 'security_events.review_note',
    table: securityEvents,
    id: securityEvents.id,
    column: securityEvents.reviewNote,
    json: false,
    scope: byUser(securityEvents.userId),
  },
  {
    name: 'member_roles.reason',
    table: memberRoles,
    id: memberRoles.id,
    column: memberRoles.reason,
    json: false,
    scope: byMember(memberRoles.memberId),
  },
  {
    name: 'rank_history.reason',
    table: rankHistory,
    id: rankHistory.id,
    column: rankHistory.reason,
    json: false,
    scope: byMember(rankHistory.memberId),
  },
  {
    name: 'member_achievements.note',
    table: memberAchievements,
    id: memberAchievements.id,
    column: memberAchievements.note,
    json: false,
    scope: byMember(memberAchievements.memberId),
  },
  {
    name: 'contributions.review_note',
    table: contributions,
    id: contributions.id,
    column: contributions.reviewNote,
    json: false,
    scope: byMember(contributions.memberId),
  },
  {
    name: 'trial_evaluations.notes',
    table: trialEvaluations,
    id: trialEvaluations.id,
    column: trialEvaluations.notes,
    json: false,
    // Her own evaluations and her team's (team evaluations carry no member id).
    scope: (t) =>
      or(
        eq(trialEvaluations.memberId, t.memberId),
        inArray(trialEvaluations.trialId, herTrials(t)),
      ),
  },
  {
    name: 'verifications.decision_note',
    table: verifications,
    id: verifications.id,
    column: verifications.decisionNote,
    json: false,
    scope: byMember(verifications.subjectMemberId),
  },
  {
    name: 'verifications.revoke_reason',
    table: verifications,
    id: verifications.id,
    column: verifications.revokeReason,
    json: false,
    scope: byMember(verifications.subjectMemberId),
  },
  {
    name: 'applications.decision_reason',
    table: applications,
    id: applications.id,
    column: applications.decisionReason,
    json: false,
    scope: byUser(applications.userId),
  },
  {
    name: 'application_reviews.note',
    table: applicationReviews,
    id: applicationReviews.id,
    column: applicationReviews.note,
    json: false,
    scope: ofApplications(applicationReviews.applicationId),
  },
  {
    name: 'application_status_changes.note',
    table: applicationStatusChanges,
    id: applicationStatusChanges.id,
    column: applicationStatusChanges.note,
    json: false,
    scope: ofApplications(applicationStatusChanges.applicationId),
  },
  {
    name: 'mission_assignments.feedback',
    table: missionAssignments,
    id: missionAssignments.id,
    column: missionAssignments.feedback,
    json: false,
    scope: byMember(missionAssignments.memberId),
  },
  {
    name: 'member_achievements.revoke_reason',
    table: memberAchievements,
    id: memberAchievements.id,
    column: memberAchievements.revokeReason,
    json: false,
    scope: byMember(memberAchievements.memberId),
  },
  {
    name: 'referrals.review_note',
    table: referrals,
    id: referrals.id,
    column: referrals.reviewNote,
    json: false,
    scope: (t) => or(eq(referrals.inviterUserId, t.userId), eq(referrals.inviteeUserId, t.userId)),
  },
  {
    name: 'adversarial_observations.description',
    table: adversarialObservations,
    id: adversarialObservations.id,
    column: adversarialObservations.description,
    json: false,
    scope: (t) =>
      or(
        eq(adversarialObservations.subjectMemberId, t.memberId),
        inArray(adversarialObservations.roleId, herTrialRoles(t)),
      ),
  },
  {
    name: 'adversarial_evaluations.summary',
    table: adversarialEvaluations,
    id: adversarialEvaluations.id,
    column: adversarialEvaluations.summary,
    json: false,
    scope: ofHerTrialRoles(adversarialEvaluations.roleId),
  },
  {
    name: 'adversarial_evaluations.debrief',
    table: adversarialEvaluations,
    id: adversarialEvaluations.id,
    column: adversarialEvaluations.debrief,
    json: false,
    scope: ofHerTrialRoles(adversarialEvaluations.roleId),
  },
  {
    name: 'adversarial_evaluations.override_justification',
    table: adversarialEvaluations,
    id: adversarialEvaluations.id,
    column: adversarialEvaluations.overrideJustification,
    json: false,
    scope: ofHerTrialRoles(adversarialEvaluations.roleId),
  },
  {
    name: 'adversarial_roles.abort_reason',
    table: adversarialRoles,
    id: adversarialRoles.id,
    column: adversarialRoles.abortReason,
    json: false,
    scope: ofHerTrialRoles(adversarialRoles.id),
  },
  {
    name: 'adversarial_roles.authorization_note',
    table: adversarialRoles,
    id: adversarialRoles.id,
    column: adversarialRoles.authorizationNote,
    json: false,
    scope: ofHerTrialRoles(adversarialRoles.id),
  },
];

/** The scrub targets by name, for documentation and tests. */
export const SCRUBBED_COLUMNS: readonly string[] = SCRUB_TARGETS.map((target) => target.name);

/** The column's property name on its table (what `.set()` expects). */
function columnKey(spec: ScrubTarget): string {
  const entry = Object.entries(getTableColumns(spec.table)).find(([, c]) => c === spec.column);
  if (!entry) throw new Error(`scrub target ${spec.name}: column not on its table`);
  return entry[0];
}

function applyRules(value: unknown, json: boolean, rules: readonly ScrubRule[]): unknown {
  let next = value;
  for (const rule of rules) {
    if (json) next = scrubJson(next, rule.terms, rule.replacement);
    else if (typeof next === 'string') next = scrubText(next, rule.terms, rule.replacement);
  }
  return next;
}

async function scrubColumn(
  tx: Tx,
  spec: ScrubTarget,
  target: ErasureTarget,
  rules: readonly ScrubRule[],
): Promise<number> {
  const patterns = rules.flatMap((rule) => rule.terms.flatMap(likePatterns));
  const text = sql`${spec.column}::text`;
  const matches = or(...patterns.map((pattern) => sql`${text} ilike ${pattern}`));
  let updated = 0;
  let after: unknown = null;
  for (;;) {
    // Keyset pagination: a candidate the scrub leaves unchanged is never revisited.
    const rows = (await tx.db
      .select({ id: spec.id, value: spec.column })
      .from(spec.table)
      .where(and(spec.scope(target), matches, after === null ? undefined : gt(spec.id, after)))
      .orderBy(asc(spec.id))
      .limit(SCRUB_BATCH_SIZE)) as { id: unknown; value: unknown }[];
    for (const row of rows) {
      const next = applyRules(row.value, spec.json, rules);
      if (JSON.stringify(next) === JSON.stringify(row.value)) continue;
      await tx.db
        .update(spec.table)
        .set({ [columnKey(spec)]: next } as never)
        .where(eq(spec.id, row.id));
      updated += 1;
    }
    if (rows.length < SCRUB_BATCH_SIZE) return updated;
    after = rows.at(-1)!.id;
  }
}

/**
 * Replace the person's names (and titles they wrote that travel, like ticket
 * subjects) in every kept record that can mention them.
 */
export async function scrubKeptRecords(
  tx: Tx,
  target: ErasureTarget,
  rules: readonly ScrubRule[],
): Promise<ErasureCounts> {
  const counts: ErasureCounts = {};
  const active = rules.filter((rule) => rule.terms.length > 0);
  if (active.length === 0) return counts;
  for (const spec of SCRUB_TARGETS) {
    const n = await scrubColumn(tx, spec, target, active);
    if (n > 0) counts[`scrubbed:${spec.name}`] = n;
  }
  return counts;
}
