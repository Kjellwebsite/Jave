import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { applications as applicationsTable, auditLogs, jobs } from '@jave/database';
import {
  activeRoles,
  applications,
  enqueueJob,
  grantRoleUnchecked,
  updateSettings,
} from '@jave/core';
import type { UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import {
  buttonId,
  buttonLabels,
  controls,
  modalInputIds,
  modalOf,
  payloadText,
} from './testing/helpers';

const REVIEW_CHANNEL = '400000000000000001';
const COMPLETE = {
  domainKey: 'create',
  motivation: 'I want to ship flight software with people who hold a higher bar than I do.',
  experience: 'Two years on a student cubesat team; I own the attitude-control loop.',
  projects: 'Attitude control stack <@123456789012345678> **flown twice**.',
  portfolioUrl: 'https://example.org/portfolio',
  evidenceLinks: ['https://github.com/example/adcs'],
  references: 'Ada Lovelace — ada@example.org (private)',
};

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

describe('applications — review cards and staff actions', () => {
  let bot: BotHarness;
  let applicant: Person;
  let applicationId: string;

  async function submitApplicationFor(person: Person): Promise<string> {
    const ctx = bot.kit.as(person.actor);
    const { application } = await applications.getOrCreateDraft(ctx);
    await applications.updateDraft(ctx, COMPLETE);
    await applications.submitApplication(ctx);
    await bot.drain();
    return application.id;
  }

  function cardMessage() {
    const posts = bot.gateway.callsTo('sendMessageOnce');
    const last = posts[posts.length - 1];
    if (!last) throw new Error('no card posted');
    const [channelId, , nonce] = last.args as [string, unknown, string];
    const [row] = [...bot.gateway.messages.entries()].filter(
      ([, message]) => message.channelId === channelId,
    );
    return { channelId, nonce, messageId: row![0], payload: row![1].payload };
  }

  async function card() {
    const [row] = await bot.kit.db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.id, applicationId));
    const message = bot.gateway.messages.get(row!.reviewMessageId!);
    return { row: row!, payload: message!.payload };
  }

  beforeEach(async () => {
    bot = await createBotHarness();
    await updateSettings(bot.kit.system, 'channels', { applicationsReview: REVIEW_CHANNEL });
    applicant = await bot.member({ username: 'nova' });
    applicationId = await submitApplicationFor(applicant);
  });
  afterEach(async () => {
    await bot.close();
  });

  it('posts a staff card with escaped excerpts, no references and the right buttons', async () => {
    const posted = cardMessage();
    expect(posted.channelId).toBe(REVIEW_CHANNEL);
    expect(posted.nonce).toMatch(/^ar\d+$/);
    const embed = posted.payload.embeds![0]!;
    expect(embed.title).toBe('APP-0001 — SUBMITTED');
    const text = payloadText(posted.payload);
    expect(text).toContain('nova');
    expect(text).not.toContain('Ada Lovelace');
    expect(text).not.toMatch(/<@\d{17,20}>/);
    expect(text).toContain('\\*\\*flown twice\\*\\*');
    expect(buttonLabels(posted.payload)).toEqual([
      'CLAIM',
      'REVIEW',
      'VIEW DETAILS',
      'OPEN IN DASHBOARD',
    ]);
    const link = controls(posted.payload).find((c) => c.type === 'link');
    expect(link?.url).toBe(`https://jave.test/applications/${applicationId}`);
    const { row } = await card();
    expect(row.reviewMessageId).toBe(posted.messageId);
    expect(row.reviewCardLeaseId).toBeNull();
  });

  it('runs claim → review → interview → accept from the card, editing it in place', async () => {
    const reviewer = await bot.member({ roles: ['core'], username: 'theo' });
    const { payload } = await card();

    const claim = await bot.run({
      kind: 'button',
      name: buttonId(payload, 'Claim'),
      user: reviewer.user,
    });
    expect(claim.interaction.lastText()).toContain('CLAIMED — APP-0001');
    const claimed = await card();
    expect(claimed.payload.embeds![0]!.title).toBe('APP-0001 — IN REVIEW');
    expect(payloadText(claimed.payload)).toContain('theo');
    expect(bot.gateway.callsTo('sendMessageOnce')).toHaveLength(1);
    expect(bot.gateway.callsTo('editMessage').length).toBeGreaterThan(0);

    const reviewOpen = await bot.run({
      kind: 'button',
      name: buttonId(claimed.payload, 'Review'),
      user: reviewer.user,
    });
    expect(modalInputIds(modalOf(reviewOpen.interaction))).toEqual([
      'recommendation',
      'score',
      'note',
    ]);
    const review = await bot.run({
      kind: 'modal',
      name: customId('applications', 'review_submit', applicationId),
      user: reviewer.user,
      modalSelect: { recommendation: ['interview'], score: ['4'] },
      modalText: { note: 'Strong flight logs; want to hear about failure handling.' },
    });
    expect(review.interaction.lastText()).toContain('REVIEW RECORDED');
    const reviewed = await card();
    expect(payloadText(reviewed.payload)).toContain('1 counted');
    expect(buttonLabels(reviewed.payload)).toEqual([
      'REVIEW',
      'INTERVIEW',
      'ACCEPT',
      'REJECT',
      'VIEW DETAILS',
      'OPEN IN DASHBOARD',
    ]);

    const interviewOpen = await bot.run({
      kind: 'button',
      name: buttonId(reviewed.payload, 'Interview'),
      user: reviewer.user,
    });
    expect(modalOf(interviewOpen.interaction).title).toBe('INTERVIEW — APP-0001');
    const interview = await bot.run({
      kind: 'modal',
      name: customId('applications', 'interview_submit', applicationId),
      user: reviewer.user,
      modalText: { time: 'tomorrow 18:00', message: 'Voice channel: Briefing Room.' },
    });
    expect(interview.interaction.lastText()).toContain('INTERVIEW SET — APP-0001');
    const scheduled = await card();
    expect(scheduled.row.status).toBe('interview');
    expect(scheduled.row.interviewAt?.toISOString()).toBe('2026-03-02T18:00:00.000Z');

    const moveOpen = await bot.run({
      kind: 'button',
      name: buttonId(scheduled.payload, 'Interview'),
      user: reviewer.user,
    });
    const moveModal = modalOf(moveOpen.interaction);
    expect(moveModal.title).toBe('MOVE INTERVIEW — APP-0001');
    expect(JSON.stringify(moveModal)).toContain('2026-03-02 18:00');

    const acceptConfirm = await bot.run({
      kind: 'button',
      name: buttonId(scheduled.payload, 'Accept'),
      user: reviewer.user,
    });
    expect(acceptConfirm.interaction.lastText()).toContain('ACCEPT APP-0001?');
    expect(acceptConfirm.interaction.lastText()).toContain('Grants TRIAL');
    const [before] = await bot.kit.db.select().from(applicationsTable);
    expect(before!.status).toBe('interview');

    const acceptForm = await bot.run({
      kind: 'button',
      name: buttonId(acceptConfirm.interaction.lastPayload(), 'Continue to accept'),
      user: reviewer.user,
    });
    expect(modalInputIds(modalOf(acceptForm.interaction))).toEqual(['reason', 'message']);
    const accepted = await bot.run({
      kind: 'modal',
      name: customId('applications', 'decide_submit', 'accept', applicationId),
      user: reviewer.user,
      modalText: { reason: 'Interview confirmed ownership of the ADCS loop.', message: 'Welcome.' },
    });
    expect(accepted.interaction.lastText()).toContain('APPLICATION ACCEPTED — APP-0001');
    expect(accepted.interaction.lastText()).toContain('TRIAL granted');
    expect(await activeRoles(bot.kit.system, applicant.actor.memberId!)).toContain('trial');
    const decided = await card();
    expect(decided.payload.embeds![0]!.title).toBe('APP-0001 — ACCEPTED');
    expect(buttonLabels(decided.payload)).toEqual(['VIEW DETAILS', 'OPEN IN DASHBOARD']);
    expect(payloadText(decided.payload)).not.toContain('Interview confirmed ownership');

    const stale = await bot.run({
      kind: 'button',
      name: buttonId(reviewed.payload, 'Review'),
      user: reviewer.user,
    });
    expect(stale.interaction.lastText()).toContain('APP-0001 is ACCEPTED');
  });

  it('VIEW DETAILS shows the private staff view, audited', async () => {
    const staff = await bot.member({ roles: ['operations'] });
    const { payload } = await card();
    const { interaction } = await bot.run({
      kind: 'button',
      name: buttonId(payload, 'View details'),
      user: staff.user,
    });
    const reply = interaction.lastPayload()!;
    expect(reply.ephemeral).toBe(true);
    const text = interaction.lastText();
    expect(text).toContain('APPLICATION — STAFF VIEW');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('https://github.com/example/adcs');
    expect(buttonLabels(reply)).toEqual(['CLAIM', 'REVIEW', 'OPEN IN DASHBOARD']);
    const viewed = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'application.viewed'));
    expect(viewed).toHaveLength(1);
  });

  it('rejection runs through confirm and modal, and keeps the reason internal', async () => {
    const decider = await bot.member({ roles: ['core'] });
    await applications.reviewApplication(bot.kit.as(decider.actor), {
      applicationId,
      recommendation: 'reject',
      score: 2,
    });
    await bot.drain();
    const confirm = await bot.run({
      kind: 'button',
      name: customId('applications', 'reject', applicationId),
      user: decider.user,
    });
    expect(confirm.interaction.lastText()).toContain('blocks a new submission for 30 days');
    const rejected = await bot.run({
      kind: 'modal',
      name: customId('applications', 'decide_submit', 'reject', applicationId),
      user: decider.user,
      modalText: { reason: 'No verifiable proof of the claimed work.', message: '' },
    });
    expect(rejected.interaction.lastText()).toContain('APPLICATION NOT ACCEPTED — APP-0001');
    const roles = await activeRoles(bot.kit.system, applicant.actor.memberId!);
    expect(roles).toContain('member');
    expect(roles).not.toContain('applicant');
    await bot.drain();
    const dm = bot.gateway.dms.find((m) => payloadText(m.payload).includes('NOT ACCEPTED'));
    expect(dm).toBeDefined();
    expect(payloadText(dm!.payload)).not.toContain('No verifiable proof');
  });

  it('staff queue lists in-flight applications and opens one', async () => {
    const staff = await bot.member({ roles: ['operations'] });
    const other = await bot.member({ username: 'vega' });
    await submitApplicationFor(other);
    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'applications',
      user: staff.user,
      subcommand: 'queue',
    });
    const text = interaction.lastText();
    expect(text).toContain('APP-0001');
    expect(text).toContain('APP-0002');
    const select = controls(interaction.lastPayload()).find((c) => c.type === 'select')!;
    expect(select.options).toHaveLength(2);
    const picked = await bot.run({
      kind: 'select',
      name: select.customId!,
      user: staff.user,
      values: [applicationId],
    });
    expect(picked.interaction.lastText()).toContain('APP-0001 — SUBMITTED');

    const mine = await bot.run({
      kind: 'slash',
      name: 'applications',
      user: staff.user,
      subcommand: 'queue',
      options: { mine: true },
    });
    expect(mine.interaction.lastText()).toContain('Nothing waiting.');
  });

  describe('BREAK', () => {
    it('non-staff pressing staff buttons are refused and audited', async () => {
      const member = await bot.member({ roles: ['verified'] });
      for (const action of ['start_review', 'review', 'accept', 'details']) {
        const { interaction } = await bot.run({
          kind: 'button',
          name: customId('applications', action, applicationId),
          user: member.user,
        });
        expect(interaction.lastText(), action).toContain('ACCESS RESTRICTED');
        expect(interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      }
      const queue = await bot.run({
        kind: 'slash',
        name: 'applications',
        user: member.user,
        subcommand: 'queue',
      });
      expect(queue.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.result, 'denied')));
      expect(denials.length).toBeGreaterThanOrEqual(4);
      const [row] = await bot.kit.db.select().from(applicationsTable);
      expect(row!.status).toBe('submitted');
    });

    it('a reviewer without decision rights never sees the interview form', async () => {
      const operations = await bot.member({ roles: ['operations'] });
      await applications.reviewApplication(bot.kit.as(operations.actor), {
        applicationId,
        recommendation: 'accept',
        score: 5,
      });
      for (const action of ['schedule_interview', 'accept', 'reject']) {
        const { interaction } = await bot.run({
          kind: 'button',
          name: customId('applications', action, applicationId),
          user: operations.user,
        });
        expect(interaction.lastText(), action).toContain('ACCESS RESTRICTED');
      }
      const forgedDecision = await bot.run({
        kind: 'modal',
        name: customId('applications', 'decide_submit', 'accept', applicationId),
        user: operations.user,
        modalText: { reason: 'Forged modal submission.' },
      });
      expect(forgedDecision.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const [row] = await bot.kit.db.select().from(applicationsTable);
      expect(row!.status).toBe('review');
    });

    it('decisions need enough counted reviews, even from a forged button', async () => {
      const decider = await bot.member({ roles: ['core'] });
      const early = await bot.run({
        kind: 'button',
        name: customId('applications', 'decide', 'reject', applicationId),
        user: decider.user,
      });
      expect(early.interaction.lastText()).toContain('needs more counted reviews');
      const forged = await bot.run({
        kind: 'modal',
        name: customId('applications', 'decide_submit', 'reject', applicationId),
        user: decider.user,
        modalText: { reason: 'Skipping the review step.' },
      });
      expect(forged.interaction.lastText()).toContain('A decision needs 1 review(s)');
    });

    it('staff cannot act on their own application', async () => {
      await grantRoleUnchecked(bot.kit.system, {
        memberId: applicant.actor.memberId!,
        role: 'core',
        reason: 'promoted while applying',
      });
      for (const action of ['details', 'start_review', 'review']) {
        const { interaction } = await bot.run({
          kind: 'button',
          name: customId('applications', action, applicationId),
          user: applicant.user,
        });
        expect(interaction.lastText(), action).toContain('You cannot act on your own application.');
      }
      const blocked = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'application.self_action_blocked'));
      expect(blocked.length).toBe(3);
    });

    it('forged and malformed custom ids fail safely', async () => {
      const staff = await bot.member({ roles: ['core'] });
      const cases: [string, string][] = [
        [customId('applications', 'review', 'not-a-uuid'), 'INVALID INPUT'],
        [customId('applications', 'review', '00000000-0000-4000-8000-000000000000'), 'NOT FOUND'],
        [customId('applications', 'decide', 'promote', applicationId), 'Unknown decision.'],
        [customId('applications', 'nonsense'), 'EXPIRED'],
        [customId('applications', 'queue', '-5', 'all'), 'Invalid page.'],
      ];
      for (const [name, expected] of cases) {
        const { interaction } = await bot.run({ kind: 'button', name, user: staff.user });
        expect(interaction.lastText(), name).toContain(expected);
      }
      const garbageTime = await bot.run({
        kind: 'modal',
        name: customId('applications', 'interview_submit', applicationId),
        user: staff.user,
        modalText: { time: 'whenever works' },
      });
      expect(garbageTime.interaction.lastText()).toContain('Could not read that time.');
      const badRecommendation = await bot.run({
        kind: 'modal',
        name: customId('applications', 'review_submit', applicationId),
        user: staff.user,
        modalSelect: { recommendation: ['promote'], score: ['9'] },
      });
      expect(badRecommendation.interaction.lastText()).toContain('Choose a recommendation.');
      const abstainWithScore = await bot.run({
        kind: 'modal',
        name: customId('applications', 'review_submit', applicationId),
        user: staff.user,
        modalSelect: { recommendation: ['abstain'], score: ['3'] },
      });
      expect(abstainWithScore.interaction.lastText()).toContain('INVALID INPUT');
    });
  });

  describe('review card job failures', () => {
    async function lastJob() {
      const rows = await bot.kit.db
        .select()
        .from(jobs)
        .where(eq(jobs.type, applications.APPLICATION_REVIEW_CARD_JOB));
      return rows.sort((a, b) => b.id - a.id)[0]!;
    }

    it('reposts when the stored card message was deleted', async () => {
      const first = cardMessage();
      bot.gateway.messages.delete(first.messageId);
      const staff = await bot.member({ roles: ['core'] });
      await bot.run({
        kind: 'button',
        name: customId('applications', 'start_review', applicationId),
        user: staff.user,
      });
      const { row, payload } = await card();
      expect(row.reviewMessageId).not.toBe(first.messageId);
      expect(payload.embeds![0]!.title).toBe('APP-0001 — IN REVIEW');
    });

    it('dead-letters on missing access and releases the render lease', async () => {
      const staff = await bot.member({ roles: ['core'] });
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('edit message failed: Missing Access', 50001, true),
      );
      await bot.run({
        kind: 'button',
        name: customId('applications', 'start_review', applicationId),
        user: staff.user,
      });
      await bot.drain();
      const job = await lastJob();
      expect(job.status).toBe('dead');
      const [row] = await bot.kit.db.select().from(applicationsTable);
      expect(row!.reviewCardLeaseId).toBeNull();
    });

    it('retries rate limits, then converges on the latest revision', async () => {
      const staff = await bot.member({ roles: ['core'] });
      bot.gateway.failures.set(
        'editMessage',
        new DiscordActionError('edit message failed: rate limited', 429, false),
      );
      await bot.run({
        kind: 'button',
        name: customId('applications', 'start_review', applicationId),
        user: staff.user,
      });
      const failed = await lastJob();
      expect(failed.status).toBe('pending');
      expect(failed.attempts).toBe(1);
      bot.kit.clock.advance(60_000);
      await bot.drain();
      const { row, payload } = await card();
      expect(payload.embeds![0]!.title).toBe('APP-0001 — IN REVIEW');
      expect(row.reviewCardRenderedRevision).toBe(row.reviewCardRevision);
    });

    it('a render that outlived its lease runs the repair render at once', async () => {
      const staff = await bot.member({ roles: ['core'] });
      const reviewer = await bot.member({ roles: ['operations'] });
      const edit = bot.gateway.editMessage.bind(bot.gateway);
      let overtaken = false;
      bot.gateway.editMessage = async (channelId, messageId, payload) => {
        if (!overtaken) {
          overtaken = true;
          // The first render stalls past its lease; a newer change renders meanwhile.
          bot.kit.clock.advance(applications.REVIEW_CARD_RENDER_LEASE_MS + 1_000);
          const ctx = bot.kit.as(reviewer.actor);
          await applications.reviewApplication(ctx, {
            applicationId,
            recommendation: 'accept',
            score: 4,
          });
          await bot.app.worker.runNow(ctx.effects.jobIds);
        }
        return edit(channelId, messageId, payload);
      };
      await bot.run({
        kind: 'button',
        name: customId('applications', 'start_review', applicationId),
        user: staff.user,
      });
      const pending = await bot.kit.db
        .select()
        .from(jobs)
        .where(
          and(eq(jobs.type, applications.APPLICATION_REVIEW_CARD_JOB), eq(jobs.status, 'pending')),
        );
      expect(pending).toHaveLength(0);
      const { row, payload } = await card();
      expect(row.reviewCardRenderedRevision).toBe(row.reviewCardRevision);
      expect(row.reviewCardLeaseId).toBeNull();
      expect(payloadText(payload)).toContain('1 counted');
    });

    it('skips quietly when no review channel is configured', async () => {
      await updateSettings(bot.kit.system, 'channels', { applicationsReview: undefined });
      const other = await bot.member({ username: 'lyra' });
      const before = bot.gateway.callsTo('sendMessageOnce').length;
      await submitApplicationFor(other);
      expect(bot.gateway.callsTo('sendMessageOnce')).toHaveLength(before);
      const job = await lastJob();
      expect(job.status).toBe('completed');
    });

    it('BREAK: a malformed payload dead-letters immediately', async () => {
      expect(bot.app.worker.handlerTypes).toContain(applications.APPLICATION_REVIEW_CARD_JOB);
      await enqueueJob(bot.kit.system, applications.APPLICATION_REVIEW_CARD_JOB, {
        applicationId: 'x',
        revision: 0,
      });
      await bot.drain();
      const job = await lastJob();
      expect(job.status).toBe('dead');
      expect(job.lastError).toContain('invalid review card payload');
    });
  });
});
