import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  domainEvents,
  evidence,
  jobs,
  members,
  notifications,
  rankHistory,
  trialResults,
} from '@jave/database';
import { MINUTE } from '../kernel/clock';
import type { JobHandlerMap } from '../jobs/worker';
import { createTestKit, type TestKit } from '../testing';
import {
  applyRankConsequence,
  applyToTrial,
  assignTeams,
  createTrial,
  evaluate,
  getTrialForParticipant,
  getTrialForStaff,
  listTemplates,
  listTrials,
  memberTrialHistory,
  myTrials,
  openRecruitment,
  publishResults,
  remainingTime,
  seedStarterTemplates,
  selectParticipants,
  startTrial,
  submit,
} from './index';
import {
  ANNOUNCEMENTS_CHANNEL_ID,
  configureDiscord,
  createFakeDiscordLog,
  type FakeDiscordLog,
  members as makeMembers,
  STATEMENT,
  trialHandlers,
  PGLITE_HOOK_TIMEOUT_MS,
  PGLITE_SUITE,
} from './testing/fixtures';

const FULL_MARKS = { shipped: 10, user_value: 10, scope_judgement: 10, quality: 10, leverage: 10 };
const STRONG = { shipped: 9, user_value: 8, scope_judgement: 8, quality: 7, leverage: 9 }; // 8.30
const WEAK = { shipped: 5, user_value: 5, scope_judgement: 5, quality: 5, leverage: 5 }; // 5.00
const DURATION = 48 * 60;

describe('trials: full lifecycle', PGLITE_SUITE, () => {
  let kit: TestKit;
  let log: FakeDiscordLog;
  let handlers: JobHandlerMap;

  beforeEach(async () => {
    kit = await createTestKit();
    log = createFakeDiscordLog();
    handlers = trialHandlers(log);
    await configureDiscord(kit);
  }, PGLITE_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, PGLITE_HOOK_TIMEOUT_MS);

  async function notificationsOf(type: string) {
    return kit.db.select().from(notifications).where(eq(notifications.type, type));
  }

  async function eventsOf(type: string) {
    return kit.db.select().from(domainEvents).where(eq(domainEvents.type, type));
  }

  it('template → recruit → teams → live → warnings → submit → close → evaluate → publish → rank', async () => {
    const ops = await kit.member({ roles: ['operations'] });
    const evaluator = await kit.member({ roles: ['operations'] });
    const core = await kit.member({ roles: ['core'] });

    // Templates: seeded once, idempotently.
    const seeded = await seedStarterTemplates(kit.as(ops));
    expect(seeded.created).toHaveLength(6);
    expect((await seedStarterTemplates(kit.as(ops))).created).toEqual([]);
    const template = (await listTemplates(kit.as(ops))).find(
      (t) => t.key === 'build-48-hour-ship',
    )!;

    // Draft → recruiting, the recruitment card is posted by the bot.
    const draft = await createTrial(kit.as(ops), { templateId: template.id, teamSize: 2 });
    expect(draft).toMatchObject({
      status: 'draft',
      durationMinutes: DURATION,
      title: '48-Hour Ship',
    });
    expect(draft.ref).toMatch(/^TRIAL-\d{4}$/);
    const trialId = draft.id;
    await openRecruitment(kit.as(ops), { trialId });
    await kit.drain(handlers);
    expect(log.posted).toEqual([
      {
        kind: 'announce',
        channelId: ANNOUNCEMENTS_CHANNEL_ID,
        text: `${draft.ref} — 48-HOUR SHIP`,
      },
    ]);

    // Five eligible members apply; domains differ so balance matters.
    const people = [
      ...(await makeMembers(kit, 3, ['trial'])),
      ...(await makeMembers(kit, 2, ['verified'])),
    ];
    const domains = ['create', 'create', 'mind', 'mind', 'life'];
    for (const [i, person] of people.entries()) {
      await kit.db
        .update(members)
        .set({ primaryDomain: domains[i]! })
        .where(eq(members.id, person.memberId!));
      await applyToTrial(kit.as(person), { trialId, statement: STATEMENT });
    }
    const listed = await listTrials(kit.as(people[0]!), { status: 'recruiting' });
    expect(listed.items.map((t) => t.id)).toEqual([trialId]);

    // Random selection is reproducible from its seed.
    const selection = await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'random',
      count: 4,
      seed: 'draw-1',
    });
    expect(selection.selectedMemberIds).toHaveLength(4);
    const redraw = await selectParticipants(kit.as(ops), {
      trialId,
      mode: 'random',
      count: 4,
      seed: 'draw-1',
    });
    expect(redraw.selectedMemberIds).toEqual(selection.selectedMemberIds);

    // Balanced teams, names, leads, seed recorded in the audit log.
    const assignment = await assignTeams(kit.as(ops), {
      trialId,
      strategy: 'balanced',
      seed: 'teams-1',
    });
    expect(assignment.teams.map((t) => t.name)).toEqual(['UNIT ALPHA', 'UNIT BRAVO']);
    expect(assignment.teams.map((t) => t.memberIds.length)).toEqual([2, 2]);
    expect(assignment.waitlisted).toBe(1);
    const verifiedIds = new Set(people.slice(3).map((p) => p.memberId));
    for (const team of assignment.teams) {
      if (team.memberIds.some((id) => verifiedIds.has(id)))
        expect(verifiedIds.has(team.leadMemberId)).toBe(true);
    }
    const [assignAudit] = await kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'trial.teams_assigned'));
    expect(assignAudit!.context).toMatchObject({ seed: 'teams-1', strategy: 'balanced' });
    expect(await notificationsOf('trial.update')).toHaveLength(5); // 4 team + 1 waitlisted

    // The bot provisions one private channel per team; the card closes.
    await kit.drain(handlers);
    expect(log.channels.size).toBe(2);
    expect([...log.channels.values()].map((c) => c.name).sort()).toEqual([
      `${draft.ref.toLowerCase()}-unit-alpha`,
      `${draft.ref.toLowerCase()}-unit-bravo`,
    ]);
    expect(log.posted.at(-1)).toMatchObject({ kind: 'announce-edit', text: 'RECRUITMENT CLOSED' });

    // Start: deadline = now + duration; briefs posted; everyone notified.
    const startedAt = kit.clock.now();
    const live = await startTrial(kit.as(ops), { trialId });
    expect(live.status).toBe('active');
    expect(live.deadlineAt!.getTime()).toBe(startedAt.getTime() + DURATION * MINUTE);
    await kit.drain(handlers);
    expect(log.posted.filter((p) => p.kind === 'brief')).toHaveLength(2);
    expect(await notificationsOf('trial.starting')).toHaveLength(4);

    const [alpha, bravo] = assignment.teams as [
      (typeof assignment.teams)[number],
      (typeof assignment.teams)[number],
    ];
    const actorOf = (memberId: string) => people.find((p) => p.memberId === memberId)!;
    const alphaA = actorOf(alpha.memberIds[0]!);
    const alphaB = actorOf(alpha.memberIds[1]!);
    const bravoA = actorOf(bravo.memberIds[0]!);

    const view = await getTrialForParticipant(kit.as(alphaA), { trialId });
    expect(view.brief).toContain('MISSION');
    expect(view.rubric?.map((c) => c.key)).toContain('shipped');
    expect(view.participation?.team?.name).toBe('UNIT ALPHA');
    expect(view.canSubmit).toBe(true);

    // Versioned submissions from either team member.
    const v1 = await submit(kit.as(alphaA), {
      trialId,
      summary: 'Shipped a working intake tool to three clinics.',
      links: ['https://example.com/alpha'],
    });
    const v2 = await submit(kit.as(alphaB), {
      trialId,
      summary: 'v2: onboarding fixed, 40 real sign-ups since v1.',
    });
    expect([v1.version, v2.version, v2.isLate]).toEqual([1, 2, false]);

    // Deadline warnings at 60 and 10 minutes, as DMs and in team channels.
    kit.clock.set(new Date(live.deadlineAt!.getTime() - 60 * MINUTE));
    await kit.drain(handlers);
    expect(await notificationsOf('trial.deadline')).toHaveLength(4);
    expect(log.posted.filter((p) => p.kind === 'warning')).toHaveLength(2);
    kit.clock.set(new Date(live.deadlineAt!.getTime() - 10 * MINUTE));
    await kit.drain(handlers);
    expect(await notificationsOf('trial.deadline')).toHaveLength(8);
    expect((await remainingTime(kit.as(alphaA), { trialId })).remainingLabel).toBe('10m');

    // Within the grace period a submission is accepted but flagged late.
    kit.clock.set(new Date(live.deadlineAt!.getTime() + 5 * MINUTE));
    const late = await submit(kit.as(bravoA), {
      trialId,
      summary: 'Bravo shipped a prototype, partially working.',
    });
    expect(late.isLate).toBe(true);

    // The close job fires at deadline + grace: evaluating, evaluators notified.
    kit.clock.set(new Date(live.deadlineAt!.getTime() + 15 * MINUTE));
    await kit.drain(handlers);
    const closed = await getTrialForStaff(kit.as(ops), { trialId });
    expect(closed.status).toBe('evaluating');
    expect(closed.submissionsClosedAt).not.toBeNull();
    expect(closed.teams[0]!.submissions.map((s) => s.version)).toEqual([2, 1]);
    const evalRequests = await notificationsOf('trial.evaluation_requested');
    expect(evalRequests.map((n) => n.recipientUserId).sort()).toEqual(
      [ops.userId, evaluator.userId, core.userId].sort(),
    );

    // Evaluate: team scores, one individual score, upsert replaces.
    await evaluate(kit.as(evaluator), { trialId, teamId: alpha.id, scores: WEAK });
    const replaced = await evaluate(kit.as(evaluator), {
      trialId,
      teamId: alpha.id,
      scores: STRONG,
      notes: 'Real users, real data.',
    });
    expect(replaced.overallScore).toBe(8.3);
    await evaluate(kit.as(evaluator), { trialId, memberId: alphaA.memberId!, scores: WEAK });
    const individual = await evaluate(kit.as(evaluator), {
      trialId,
      memberId: alphaA.memberId!,
      scores: FULL_MARKS,
    });
    expect(individual).toMatchObject({ teamId: alpha.id, overallScore: 10 });
    await evaluate(kit.as(evaluator), { trialId, teamId: bravo.id, scores: WEAK });
    const staff = await getTrialForStaff(kit.as(ops), { trialId });
    expect(staff.teams[0]!.evaluations).toHaveLength(2);
    expect(staff.results?.published).toBe(false);

    // Publish: results, events, notifications, archive.
    const published = await publishResults(kit.as(ops), { trialId });
    expect(published.counts).toEqual({ distinction: 1, pass: 1, fail: 2, incomplete: 0 });
    const resultOf = (memberId: string) => published.results.find((r) => r.memberId === memberId)!;
    expect(resultOf(alphaA.memberId!)).toMatchObject({
      teamScore: 8.3,
      individualScore: 10,
      finalScore: 8.98,
      outcome: 'distinction',
      recommendedRank: 'B',
      facetKey: 'create.projects',
    });
    expect(resultOf(alphaB.memberId!)).toMatchObject({ finalScore: 8.3, outcome: 'pass' });
    expect(resultOf(bravoA.memberId!)).toMatchObject({ finalScore: 5, outcome: 'fail' });
    expect(await eventsOf('trial.result_published')).toHaveLength(4);
    expect((await eventsOf('trial.passed')).map((e) => e.subjectMemberId).sort()).toEqual(
      [alphaA.memberId, alphaB.memberId].sort(),
    );
    expect(await eventsOf('trial.completed')).toHaveLength(1);
    const results = await notificationsOf('trial.result');
    expect(results).toHaveLength(4);
    expect(results.find((n) => n.recipientUserId === alphaA.userId)!.body).toContain(
      'DISTINCTION — 8.98 / 10',
    );

    await kit.drain(handlers);
    expect([...log.channels.values()].every((c) => c.locked)).toBe(true);
    const archived = await getTrialForStaff(kit.as(ops), { trialId });
    expect(archived.teams.every((t) => t.archivedAt !== null)).toBe(true);

    // After completion the participant sees their result and the other team's work.
    const after = await getTrialForParticipant(kit.as(alphaA), { trialId });
    expect(after.result).toMatchObject({ outcome: 'distinction', finalScore: 8.98 });
    expect(after.otherSubmissions.map((s) => s.teamName)).toEqual(['UNIT BRAVO']);

    // Rank consequence: explicit, by an evaluator with canModifyRanks.
    const receipt = await applyRankConsequence(kit.as(core), {
      trialId,
      memberId: alphaA.memberId!,
    });
    expect(receipt).toMatchObject({ facetKey: 'create.projects', rank: 'B' });
    const [history] = await kit.db
      .select()
      .from(rankHistory)
      .where(eq(rankHistory.id, receipt.rankHistoryId));
    expect(history).toMatchObject({ source: 'trial', sourceRef: trialId, toRank: 'B' });
    const [record] = await kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.id, receipt.evidenceId));
    expect(record).toMatchObject({ kind: 'trial', sourceType: 'trial', sourceId: trialId });
    const [stored] = await kit.db
      .select()
      .from(trialResults)
      .where(and(eq(trialResults.trialId, trialId), eq(trialResults.memberId, alphaA.memberId!)));
    expect(stored!.rankHistoryId).toBe(receipt.rankHistoryId);

    // Histories.
    const mine = await myTrials(kit.as(alphaA));
    expect(mine[0]).toMatchObject({
      outcome: 'distinction',
      rankApplied: true,
      teamName: 'UNIT ALPHA',
    });
    const theirs = await memberTrialHistory(kit.as(ops), { memberId: bravoA.memberId! });
    expect(theirs[0]).toMatchObject({ outcome: 'fail', finalScore: 5 });

    // Nothing is left dead in the queue.
    const dead = await kit.db.select().from(jobs).where(eq(jobs.status, 'dead'));
    expect(dead).toEqual([]);
  });
});
