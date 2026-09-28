import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notLike,
  or,
  sql,
} from 'drizzle-orm';
import {
  achievementDefinitions,
  aiActionProposals,
  applicationReviews,
  auditLogs,
  aiRequests,
  applicationStatusChanges,
  applications,
  contributions,
  eventRsvps,
  events,
  eventTeamMembers,
  eventTeams,
  evidence,
  externalAccounts,
  gamePlayers,
  gameSessions,
  memberAchievements,
  memberCapabilities,
  memberNotes,
  memberRoles,
  members,
  missionAssignments,
  missions,
  modCases,
  notificationPreferences,
  notifications,
  projectMembers,
  projects,
  rankHistory,
  referralCodes,
  referrals,
  researchItems,
  securityEvents,
  sessions,
  ticketMessages,
  tickets,
  trialEvaluations,
  trialParticipants,
  trialResults,
  trials,
  trialSubmissions,
  trialTeams,
  userPreferences,
  users,
  verifications,
} from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { EXPORT_SECTION_LIMIT } from './constants';

/**
 * One loader per export section. Each returns what JAVE shows the member
 * about themselves in the product — their own words, their records, and the
 * decisions communicated to them — and nothing written only for staff.
 * Adversarial records are never read here.
 */

export interface Subject {
  userId: string;
  memberId: string | null;
}

type Db = ServiceContext['db'];

export async function accountSection(db: Db, subject: Subject) {
  const [user] = await db
    .select({
      discordId: users.discordId,
      username: users.username,
      displayName: users.displayName,
      firstSeenAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, subject.userId));
  const [member] = subject.memberId
    ? await db
        .select({
          handle: members.handle,
          displayName: members.displayName,
          headline: members.headline,
          bio: members.bio,
          primaryDomain: members.primaryDomain,
          guildStatus: members.guildStatus,
          standing: members.standing,
          onboardingState: members.onboardingState,
          profileVisibility: members.profileVisibility,
          showClaimsPublicly: members.showClaimsPublicly,
          showOnLeaderboards: members.showOnLeaderboards,
          joinedGuildAt: members.joinedGuildAt,
          leftGuildAt: members.leftGuildAt,
          onboardedAt: members.onboardedAt,
          createdAt: members.createdAt,
        })
        .from(members)
        .where(eq(members.id, subject.memberId))
    : [];
  const [preferences] = await db
    .select({
      timezone: userPreferences.timezone,
      quietHoursStart: userPreferences.quietHoursStart,
      quietHoursEnd: userPreferences.quietHoursEnd,
      dmNotifications: userPreferences.dmNotifications,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, subject.userId));
  const notificationSettings = await db
    .select({
      type: notificationPreferences.type,
      channel: notificationPreferences.channel,
      enabled: notificationPreferences.enabled,
    })
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, subject.userId))
    .orderBy(asc(notificationPreferences.type), asc(notificationPreferences.channel));
  const linkedAccounts = subject.memberId
    ? await db
        .select({
          provider: externalAccounts.provider,
          username: externalAccounts.username,
          verifiedAt: externalAccounts.verifiedAt,
          linkedAt: externalAccounts.createdAt,
        })
        .from(externalAccounts)
        .where(eq(externalAccounts.memberId, subject.memberId))
    : [];
  const dashboardSessions = await db
    .select({
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, subject.userId))
    .orderBy(desc(sessions.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
  return {
    user: user ?? null,
    profile: member ?? null,
    preferences: preferences ?? null,
    notificationSettings,
    linkedAccounts,
    dashboardSessions,
  };
}

export async function rolesSection(db: Db, memberId: string) {
  return db
    .select({
      role: memberRoles.role,
      grantedAt: memberRoles.grantedAt,
      expiresAt: memberRoles.expiresAt,
      revokedAt: memberRoles.revokedAt,
    })
    .from(memberRoles)
    .where(eq(memberRoles.memberId, memberId))
    .orderBy(asc(memberRoles.grantedAt))
    .limit(EXPORT_SECTION_LIMIT);
}

export async function capabilitySection(db: Db, memberId: string) {
  const ranks = await db
    .select({
      facetKey: memberCapabilities.facetKey,
      claimedRank: memberCapabilities.claimedRank,
      claimedAt: memberCapabilities.claimedAt,
      verifiedRank: memberCapabilities.verifiedRank,
      verifiedAt: memberCapabilities.verifiedAt,
    })
    .from(memberCapabilities)
    .where(eq(memberCapabilities.memberId, memberId))
    .orderBy(asc(memberCapabilities.facetKey));
  const history = await db
    .select({
      facetKey: rankHistory.facetKey,
      track: rankHistory.track,
      fromRank: rankHistory.fromRank,
      toRank: rankHistory.toRank,
      source: rankHistory.source,
      reason: rankHistory.reason,
      createdAt: rankHistory.createdAt,
    })
    .from(rankHistory)
    .where(eq(rankHistory.memberId, memberId))
    .orderBy(asc(rankHistory.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
  const submittedEvidence = await db
    .select({
      kind: evidence.kind,
      title: evidence.title,
      url: evidence.url,
      description: evidence.description,
      facetKey: evidence.facetKey,
      status: evidence.status,
      createdAt: evidence.createdAt,
    })
    .from(evidence)
    .where(and(eq(evidence.memberId, memberId), isNull(evidence.deletedAt)))
    .orderBy(asc(evidence.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
  const verificationRequests = await db
    .select({
      number: verifications.number,
      type: verifications.type,
      claim: verifications.claim,
      targetType: verifications.targetType,
      targetLabel: verifications.targetLabel,
      facetKey: verifications.facetKey,
      requestedRank: verifications.requestedRank,
      grantedRank: verifications.grantedRank,
      status: verifications.status,
      decisionNote: verifications.decisionNote,
      requestedAt: verifications.requestedAt,
      decidedAt: verifications.decidedAt,
      expiresAt: verifications.expiresAt,
      revokedAt: verifications.revokedAt,
      revokeReason: verifications.revokeReason,
    })
    .from(verifications)
    .where(eq(verifications.subjectMemberId, memberId))
    .orderBy(asc(verifications.requestedAt))
    .limit(EXPORT_SECTION_LIMIT);
  return { ranks, history, evidence: submittedEvidence, verificationRequests };
}

export async function applicationsSection(db: Db, userId: string) {
  const rows = await db
    .select({
      id: applications.id,
      number: applications.number,
      status: applications.status,
      domainKey: applications.domainKey,
      experience: applications.experience,
      projects: applications.projects,
      portfolioUrl: applications.portfolioUrl,
      motivation: applications.motivation,
      references: applications.references,
      evidenceLinks: applications.evidenceLinks,
      referralCode: applications.referralCode,
      interviewAt: applications.interviewAt,
      submittedAt: applications.submittedAt,
      decidedAt: applications.decidedAt,
      messageFromReviewers: applications.applicantMessage,
      createdAt: applications.createdAt,
    })
    .from(applications)
    .where(eq(applications.userId, userId))
    .orderBy(asc(applications.createdAt));
  const ids = rows.map((row) => row.id);
  const timeline = ids.length
    ? await db
        .select({
          applicationId: applicationStatusChanges.applicationId,
          fromStatus: applicationStatusChanges.fromStatus,
          toStatus: applicationStatusChanges.toStatus,
          at: applicationStatusChanges.createdAt,
        })
        .from(applicationStatusChanges)
        .where(inArray(applicationStatusChanges.applicationId, ids))
        .orderBy(asc(applicationStatusChanges.sequence))
    : [];
  return rows.map(({ id, ...application }) => ({
    ...application,
    timeline: timeline
      .filter((change) => change.applicationId === id)
      .map(({ applicationId: _, ...change }) => change),
  }));
}

export async function trialsSection(db: Db, memberId: string) {
  const participation = await db
    .select({
      trialNumber: trials.number,
      trialTitle: trials.title,
      status: trialParticipants.status,
      team: trialTeams.name,
      teamRole: trialParticipants.teamRole,
      statement: trialParticipants.statement,
      appliedAt: trialParticipants.appliedAt,
      selectedAt: trialParticipants.selectedAt,
    })
    .from(trialParticipants)
    .innerJoin(trials, eq(trials.id, trialParticipants.trialId))
    .leftJoin(trialTeams, eq(trialTeams.id, trialParticipants.teamId))
    .where(eq(trialParticipants.memberId, memberId))
    .orderBy(asc(trialParticipants.appliedAt));
  const submissions = await db
    .select({
      trialNumber: trials.number,
      summary: trialSubmissions.summary,
      links: trialSubmissions.links,
      version: trialSubmissions.version,
      isLate: trialSubmissions.isLate,
      submittedAt: trialSubmissions.submittedAt,
    })
    .from(trialSubmissions)
    .innerJoin(trials, eq(trials.id, trialSubmissions.trialId))
    .where(eq(trialSubmissions.submittedByMemberId, memberId))
    .orderBy(asc(trialSubmissions.submittedAt));
  // Only published results: an unpublished result is still under evaluation.
  const results = await db
    .select({
      trialNumber: trials.number,
      outcome: trialResults.outcome,
      teamScore: trialResults.teamScore,
      individualScore: trialResults.individualScore,
      finalScore: trialResults.finalScore,
      facetKey: trialResults.facetKey,
      recommendedRank: trialResults.recommendedRank,
      publishedAt: trialResults.publishedAt,
    })
    .from(trialResults)
    .innerJoin(trials, eq(trials.id, trialResults.trialId))
    .where(and(eq(trialResults.memberId, memberId), isNotNull(trialResults.publishedAt)))
    .orderBy(asc(trialResults.publishedAt));
  return { participation, submissions, results };
}

export async function workSection(db: Db, memberId: string) {
  const missionWork = await db
    .select({
      missionNumber: missions.number,
      missionTitle: missions.title,
      status: missionAssignments.status,
      assignedAt: missionAssignments.assignedAt,
      acceptedAt: missionAssignments.acceptedAt,
      dueAt: missionAssignments.dueAt,
      submittedAt: missionAssignments.submittedAt,
      submission: missionAssignments.submission,
      evidenceTitle: missionAssignments.submissionEvidenceTitle,
      evidenceUrl: missionAssignments.submissionEvidenceUrl,
      attempts: missionAssignments.attempts,
      verifiedAt: missionAssignments.verifiedAt,
      feedback: missionAssignments.feedback,
    })
    .from(missionAssignments)
    .innerJoin(missions, eq(missions.id, missionAssignments.missionId))
    .where(eq(missionAssignments.memberId, memberId))
    .orderBy(asc(missionAssignments.assignedAt))
    .limit(EXPORT_SECTION_LIMIT);
  const projectMemberships = await db
    .select({
      slug: projects.slug,
      title: projects.title,
      status: projects.status,
      role: projectMembers.role,
      owner: sql<boolean>`${projects.ownerMemberId} = ${memberId}`,
      joinedAt: projectMembers.joinedAt,
      leftAt: projectMembers.leftAt,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.memberId, memberId), isNull(projects.deletedAt)))
    .orderBy(asc(projectMembers.joinedAt));
  const recordedContributions = await db
    .select({
      project: projects.slug,
      kind: contributions.kind,
      title: contributions.title,
      description: contributions.description,
      url: contributions.url,
      source: contributions.source,
      status: contributions.status,
      reviewNote: contributions.reviewNote,
      occurredAt: contributions.occurredAt,
      verifiedAt: contributions.verifiedAt,
    })
    .from(contributions)
    .leftJoin(projects, eq(projects.id, contributions.projectId))
    .where(eq(contributions.memberId, memberId))
    .orderBy(asc(contributions.occurredAt))
    .limit(EXPORT_SECTION_LIMIT);
  const achievements = await db
    .select({
      key: memberAchievements.achievementKey,
      title: achievementDefinitions.title,
      awardedAt: memberAchievements.awardedAt,
      verification: memberAchievements.verification,
      revokedAt: memberAchievements.revokedAt,
    })
    .from(memberAchievements)
    .innerJoin(
      achievementDefinitions,
      eq(achievementDefinitions.key, memberAchievements.achievementKey),
    )
    .where(eq(memberAchievements.memberId, memberId))
    .orderBy(asc(memberAchievements.awardedAt));
  return {
    missions: missionWork,
    projects: projectMemberships,
    contributions: recordedContributions,
    achievements,
  };
}

export async function communitySection(db: Db, subject: Subject) {
  const rsvps = subject.memberId
    ? await db
        .select({
          event: events.title,
          startsAt: events.startsAt,
          status: eventRsvps.status,
          respondedAt: eventRsvps.respondedAt,
          checkedInAt: eventRsvps.checkedInAt,
        })
        .from(eventRsvps)
        .innerJoin(events, eq(events.id, eventRsvps.eventId))
        .where(eq(eventRsvps.memberId, subject.memberId))
        .orderBy(asc(events.startsAt))
        .limit(EXPORT_SECTION_LIMIT)
    : [];
  const eventTeamsJoined = subject.memberId
    ? await db
        .select({ event: events.title, team: eventTeams.name })
        .from(eventTeamMembers)
        .innerJoin(eventTeams, eq(eventTeams.id, eventTeamMembers.teamId))
        .innerJoin(events, eq(events.id, eventTeamMembers.eventId))
        .where(eq(eventTeamMembers.memberId, subject.memberId))
    : [];
  const games = await db
    .select({
      game: gameSessions.gameKey,
      surface: gameSessions.surface,
      score: gamePlayers.score,
      placement: gamePlayers.placement,
      joinedAt: gamePlayers.joinedAt,
    })
    .from(gamePlayers)
    .innerJoin(gameSessions, eq(gameSessions.id, gamePlayers.sessionId))
    .where(eq(gamePlayers.userId, subject.userId))
    .orderBy(asc(gamePlayers.joinedAt))
    .limit(EXPORT_SECTION_LIMIT);
  const referralCode = await db
    .select({
      code: referralCodes.code,
      active: referralCodes.active,
      createdAt: referralCodes.createdAt,
    })
    .from(referralCodes)
    .where(eq(referralCodes.ownerUserId, subject.userId));
  // People you invited are other people: counts per status, never who.
  const invited = await db
    .select({ status: referrals.status, count: count() })
    .from(referrals)
    .where(eq(referrals.inviterUserId, subject.userId))
    .groupBy(referrals.status);
  const [joinedVia] = await db
    .select({ method: referrals.method, status: referrals.status, joinedAt: referrals.joinedAt })
    .from(referrals)
    .where(eq(referrals.inviteeUserId, subject.userId))
    .orderBy(desc(referrals.joinedAt))
    .limit(1);
  const research = await db
    .select({
      title: researchItems.title,
      url: researchItems.url,
      status: researchItems.status,
      createdAt: researchItems.createdAt,
    })
    .from(researchItems)
    .where(
      and(eq(researchItems.submittedByUserId, subject.userId), isNull(researchItems.deletedAt)),
    )
    .orderBy(asc(researchItems.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
  return {
    events: rsvps,
    eventTeams: eventTeamsJoined,
    games,
    referralCode: referralCode[0] ?? null,
    peopleYouInvited: invited,
    howYouJoined: joinedVia ?? null,
    researchSaved: research,
  };
}

export async function supportSection(db: Db, userId: string) {
  const opened = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      category: tickets.category,
      priority: tickets.priority,
      status: tickets.status,
      subject: tickets.subject,
      createdAt: tickets.createdAt,
      closedAt: tickets.closedAt,
      closeReason: tickets.closeReason,
    })
    .from(tickets)
    .where(eq(tickets.openerUserId, userId))
    .orderBy(asc(tickets.createdAt));
  const ids = opened.map((ticket) => ticket.id);
  // The conversation as the member saw it: internal notes are staff-only.
  const conversation = ids.length
    ? await db
        .select({
          ticketId: ticketMessages.ticketId,
          from: sql<string>`case when ${ticketMessages.authorUserId} = ${userId} then 'you' else ${ticketMessages.authorRole}::text end`,
          body: ticketMessages.body,
          attachments: ticketMessages.attachments,
          createdAt: ticketMessages.createdAt,
          editedAt: ticketMessages.editedAt,
        })
        .from(ticketMessages)
        .where(
          and(
            inArray(ticketMessages.ticketId, ids),
            eq(ticketMessages.isInternal, false),
            isNull(ticketMessages.deletedAt),
          ),
        )
        .orderBy(asc(ticketMessages.ticketId), asc(ticketMessages.seq))
        .limit(EXPORT_SECTION_LIMIT)
    : [];
  return opened.map(({ id, ...ticket }) => ({
    ...ticket,
    messages: conversation
      .filter((message) => message.ticketId === id)
      .map(({ ticketId: _, ...message }) => message),
  }));
}

export async function moderationSection(db: Db, userId: string) {
  // As communicated to the member: private staff notes are not moderation actions.
  return db
    .select({
      number: modCases.number,
      action: modCases.action,
      reason: modCases.reason,
      durationSeconds: modCases.durationSeconds,
      expiresAt: modCases.expiresAt,
      createdAt: modCases.createdAt,
      endedAt: modCases.endedAt,
      revokedAt: modCases.revokedAt,
    })
    .from(modCases)
    .where(and(eq(modCases.targetUserId, userId), ne(modCases.action, 'note')))
    .orderBy(asc(modCases.createdAt));
}

/**
 * Adversarial notifications (an operative's briefing, go-live, stop) are never
 * exported: an export of a teammate would otherwise name the hidden operative
 * to whoever downloads it. The member still reads them in their inbox.
 */
export async function notificationsSection(db: Db, userId: string) {
  return db
    .select({
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      url: notifications.url,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .where(
      and(eq(notifications.recipientUserId, userId), notLike(notifications.type, 'adversarial.%')),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
}

export async function aiSection(db: Db, userId: string) {
  // Prompts and answers are never stored; usage is all there is.
  const day = sql<string>`to_char(${aiRequests.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const usage = await db
    .select({ day, feature: aiRequests.feature, requests: count() })
    .from(aiRequests)
    .where(eq(aiRequests.userId, userId))
    .groupBy(day, aiRequests.feature)
    .orderBy(asc(day), asc(aiRequests.feature))
    .limit(EXPORT_SECTION_LIMIT);
  const proposals = await db
    .select({
      kind: aiActionProposals.kind,
      status: aiActionProposals.status,
      preview: aiActionProposals.preview,
      createdAt: aiActionProposals.createdAt,
      decidedAt: aiActionProposals.decidedAt,
    })
    .from(aiActionProposals)
    .where(eq(aiActionProposals.requestedByUserId, userId))
    .orderBy(asc(aiActionProposals.createdAt))
    .limit(EXPORT_SECTION_LIMIT);
  return { usage, proposals };
}

/** Rows staff hold about the member that the export does not include, by category. */
export async function withheldCounts(db: Db, subject: Subject) {
  const { userId, memberId } = subject;
  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;
  const applicationIds = db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.userId, userId));
  return {
    applicationReviews: await one(
      db
        .select({ n })
        .from(applicationReviews)
        .where(inArray(applicationReviews.applicationId, applicationIds)),
    ),
    staffNotes: memberId
      ? await one(
          db
            .select({ n })
            .from(memberNotes)
            .where(and(eq(memberNotes.memberId, memberId), isNull(memberNotes.deletedAt))),
        )
      : 0,
    evaluatorNotes: memberId
      ? await one(
          db
            .select({ n })
            .from(memberCapabilities)
            .where(
              and(eq(memberCapabilities.memberId, memberId), isNotNull(memberCapabilities.notes)),
            ),
        )
      : 0,
    trialEvaluations: memberId
      ? await one(
          db.select({ n }).from(trialEvaluations).where(eq(trialEvaluations.memberId, memberId)),
        )
      : 0,
    moderationNotes: await one(
      db
        .select({ n })
        .from(modCases)
        .where(and(eq(modCases.targetUserId, userId), eq(modCases.action, 'note'))),
    ),
    securityEvents: await one(
      db.select({ n }).from(securityEvents).where(eq(securityEvents.userId, userId)),
    ),
    auditEntries: await one(
      db
        .select({ n })
        .from(auditLogs)
        .where(
          or(
            and(eq(auditLogs.targetType, 'user'), eq(auditLogs.targetId, userId)),
            memberId
              ? and(eq(auditLogs.targetType, 'member'), eq(auditLogs.targetId, memberId))
              : sql`false`,
          ),
        ),
    ),
  };
}
