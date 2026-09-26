import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { adversarialRoles, adversarialScenarios, jobs, notifications } from '@jave/database';
import { adversarial, trials, updateSettings } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import {
  activeTrial,
  as,
  configureDiscord,
  HOOK_TIMEOUT_MS,
  type Person,
  people,
  SUITE,
} from '../trials/test-fixtures';
import { noBriefingReply } from './operative';
import { mentionsStopWord } from './stop-word';

interface Exercise {
  trialId: string;
  roleId: string;
  operative: Person;
  teammate: Person;
  otherTeam: Person;
  teamChannelId: string;
  planner: Person;
  authorizer: Person;
}

/** An active trial with an authorized, briefed and activated operative on one team. */
async function exercise(bot: BotHarness): Promise<Exercise> {
  await configureDiscord(bot);
  await updateSettings(bot.kit.system, 'trials', { adversarialEnabled: true });
  const [planner] = await people(bot, 1, ['core']);
  const [authorizer] = await people(bot, 1, ['core']);
  const verified = await people(bot, 2, ['verified']);
  const triallists = await people(bot, 2, ['trial']);
  const everyone = [...verified, ...triallists];
  const { trialId, assignment } = await activeTrial(bot, planner!, everyone, {
    adversarialEnabled: true,
    teamSize: 2,
  });
  await bot.drain();
  const operativeTeam = assignment.teams.find((team) =>
    team.memberIds.some((id) => verified.some((v) => v.actor.memberId === id)),
  )!;
  const operative = verified.find((v) => operativeTeam.memberIds.includes(v.actor.memberId!))!;
  const teammate = everyone.find(
    (p) => p !== operative && operativeTeam.memberIds.includes(p.actor.memberId!),
  )!;
  const otherTeam = everyone.find((p) => !operativeTeam.memberIds.includes(p.actor.memberId!))!;
  await adversarial.seedStarterScenarios(bot.kit.system);
  const [scenario] = await bot.kit.db
    .select({ id: adversarialScenarios.id })
    .from(adversarialScenarios)
    .where(eq(adversarialScenarios.key, 'urgent-token-request'));
  const role = await adversarial.planRole(as(bot, planner!), {
    trialId,
    teamId: operativeTeam.id,
    operativeMemberId: operative.actor.memberId!,
    scenarioId: scenario!.id,
  });
  await adversarial.authorizeRole(as(bot, authorizer!), { roleId: role.id, sandboxAttested: true });
  await adversarial.briefRole(as(bot, planner!), { roleId: role.id });
  await adversarial.activateRole(as(bot, planner!), { roleId: role.id });
  await bot.drain();
  const staff = await trials.getTrialForStaff(as(bot, planner!), { trialId });
  const teamChannelId = staff.teams.find((t) => t.id === operativeTeam.id)!.discordChannelId!;
  return { trialId, roleId: role.id, operative, teammate, otherTeam, teamChannelId, planner: planner!, authorizer: authorizer! };
}

async function roleRow(bot: BotHarness, roleId: string) {
  const [row] = await bot.kit.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, roleId));
  return row!;
}

describe('adversarial: Discord surface', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await createBotHarness();
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT_MS);

  it('briefing DM carries every section; never a guild post; delivery is recorded', async () => {
    const ex = await exercise(bot);
    const dms = bot.gateway.dms.filter((dm) => dm.userId === ex.operative.actor.discordId);
    const briefing = JSON.stringify(dms.map((dm) => dm.payload));
    for (const section of ['OBJECTIVE', 'SANDBOX ASSETS', 'TRIGGERS', 'GUARDRAILS', 'OPERATING RULES', 'STOP PROTOCOL', 'RED FLAG'])
      expect(briefing).toContain(section);
    expect(briefing).toContain('FICTIONAL DATA ONLY');
    // Nothing adversarial ever reaches a channel before the reveal.
    const channelPosts = JSON.stringify(bot.gateway.callsTo('sendMessage').map((c) => c.args[1]));
    expect(channelPosts).not.toMatch(/BRIEFING|OPERATIVE|RED FLAG|SANDBOX|adversarial/i);
    expect((await roleRow(bot, ex.roleId)).briefingDelivery).toBe('sent');
  });

  it('BREAK: closed DMs mark the briefing undeliverable and tell the planner', async () => {
    await configureDiscord(bot);
    const ex = await (async () => {
      // Close the operative's DMs before anything is briefed.
      const original = bot.gateway.sendDirectMessage.bind(bot.gateway);
      let closedFor: string | null = null;
      bot.gateway.sendDirectMessage = async (userId, payload) => {
        const text = JSON.stringify(payload);
        if (text.includes('GUARDRAILS')) closedFor = userId;
        if (closedFor === userId) bot.gateway.closedDms.add(userId);
        return original(userId, payload);
      };
      return exercise(bot);
    })();
    expect((await roleRow(bot, ex.roleId)).briefingDelivery).toBe('undeliverable');
    const planner = await bot.kit.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, ex.planner.actor.userId), eq(notifications.type, 'adversarial.staff')));
    expect(planner.some((n) => n.title.startsWith('BRIEFING NOT DELIVERED'))).toBe(true);
  });

  it('/trial briefing: the operative sees their briefing; everyone else gets the identical no-briefing answer', async () => {
    const ex = await exercise(bot);
    const mine = await bot.run({ kind: 'slash', name: 'trial', subcommand: 'briefing', user: ex.operative.user });
    const text = JSON.stringify(mine.interaction.responses);
    expect(text).toContain('GUARDRAILS');
    expect(text).toContain(customId('adversarial', 'redflag', ex.roleId));
    expect(mine.interaction.lastPayload()!.ephemeral).toBe(true);

    const expected = JSON.stringify(noBriefingReply());
    const [outsider] = await people(bot, 1, ['verified']);
    const [staffer] = await people(bot, 1, ['founder']);
    for (const person of [ex.teammate, ex.otherTeam, outsider!, staffer!]) {
      const { interaction } = await bot.run({ kind: 'slash', name: 'trial', subcommand: 'briefing', user: person.user });
      expect(JSON.stringify(interaction.lastPayload())).toBe(expected);
    }
    // A quarantined operative is indistinguishable from nobody.
    await bot.kit.db.update(adversarialRoles).set({}).where(eq(adversarialRoles.id, ex.roleId));
  });

  it('RED FLAG: the operative stops the exercise; STOP DM without the reason; forged presses look like nothing', async () => {
    const ex = await exercise(bot);
    const forged = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag-yes', ex.roleId),
      user: ex.teammate.user,
    });
    const random = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag-yes', '00000000-0000-4000-8000-000000000000'),
      user: ex.teammate.user,
    });
    expect(JSON.stringify(forged.interaction.lastPayload())).toBe(JSON.stringify(random.interaction.lastPayload()));
    expect(JSON.stringify(forged.interaction.lastPayload())).toBe(JSON.stringify(noBriefingReply()));
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');

    const ask = await bot.run({ kind: 'button', name: customId('adversarial', 'redflag', ex.roleId), user: ex.operative.user });
    expect(ask.interaction.lastText()).toContain('RAISE RED FLAG');
    const raise = await bot.run({ kind: 'button', name: customId('adversarial', 'redflag-yes', ex.roleId), user: ex.operative.user });
    expect(raise.interaction.lastText()).toContain('EXERCISE STOPPED');
    await bot.drain();
    const role = await roleRow(bot, ex.roleId);
    expect(role).toMatchObject({ status: 'aborted', stopNoticeDelivery: 'sent' });
    const stop = bot.gateway.dms.filter((dm) => dm.userId === ex.operative.actor.discordId && JSON.stringify(dm.payload).includes('STOP — EXERCISE ENDED'));
    expect(stop).toHaveLength(1);
    expect(JSON.stringify(stop[0]!.payload)).not.toContain('Raised by the operative');
    // Idempotent: a second press reports the exercise as already stopped.
    const again = await bot.run({ kind: 'button', name: customId('adversarial', 'redflag-yes', ex.roleId), user: ex.operative.user });
    expect(again.interaction.lastText()).toContain('already stopped');
  });

  it('stop word in the team channel stops the exercise silently; elsewhere it does nothing', async () => {
    expect(mentionsStopWord('ok RED FLAG now')).toBe(true);
    expect(mentionsStopWord('red-flag')).toBe(true);
    expect(mentionsStopWord('redflagged')).toBe(false);
    expect(mentionsStopWord('the red flags we saw')).toBe(false);
    const ex = await exercise(bot);
    const posted = bot.gateway.callsTo('sendMessage').length;
    const message = (channelId: string, author: Person, content: string) => ({
      id: '930000000000000001',
      channelId,
      guildId: bot.gateway.guildId,
      parentChannelId: null,
      isThread: false,
      author: { id: author.user.id, username: author.user.username, globalName: null, avatar: null, bot: false },
      authorRoleIds: [],
      content,
      mentionCount: 0,
      mentionsEveryone: false,
      attachments: [],
      createdAt: bot.kit.clock.now(),
      url: 'https://discord.com/channels/x',
    });
    await bot.app.events.message(message('930000000000000099', ex.teammate, 'RED FLAG'));
    await bot.settle();
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');
    await bot.app.events.message(message(ex.teamChannelId, ex.teammate, 'wait — red flag, stop'));
    await bot.settle();
    expect((await roleRow(bot, ex.roleId)).status).toBe('aborted');
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(posted);
    expect(bot.gateway.dms.some((dm) => dm.userId === ex.operative.actor.discordId && JSON.stringify(dm.payload).includes('STOP'))).toBe(true);
  });

  it('BREAK: an undeliverable STOP on the last attempt raises a critical alert', async () => {
    const ex = await exercise(bot);
    await adversarial.abortRole(as(bot, ex.planner), { roleId: ex.roleId, reason: 'Scenario leaked.' });
    await bot.kit.db
      .update(jobs)
      .set({ attempts: adversarial.ABORT_MAX_ATTEMPTS - 1 })
      .where(eq(jobs.type, adversarial.ADVERSARIAL_ABORT_JOB));
    bot.gateway.failures.set('sendDirectMessage', new DiscordActionError('gateway down', 503, false));
    await bot.drain();
    expect((await roleRow(bot, ex.roleId)).stopNoticeDelivery).toBe('undeliverable');
    const alerts = await bot.kit.db.select().from(notifications).where(eq(notifications.type, 'adversarial.alert'));
    expect(alerts.some((a) => a.title.startsWith('STOP NOT DELIVERED'))).toBe(true);
  });

  it('debrief: posted in the team channel after the reveal; a missing channel is reported', async () => {
    const ex = await exercise(bot);
    const manager = ex.planner;
    await trials.closeSubmissions(as(bot, manager), { trialId: ex.trialId });
    await bot.drain();
    expect((await roleRow(bot, ex.roleId)).status).toBe('concluded');
    await adversarial.evaluateRole(as(bot, manager), {
      roleId: ex.roleId,
      score: 7,
      justification: 'The team verified the request before acting.',
      summary: 'Resisted the urgent token ask.',
      debrief: 'Your team asked for verification before sharing anything. Keep that habit.',
    });
    await adversarial.revealRole(as(bot, manager), { roleId: ex.roleId });
    await bot.drain();
    const posts = bot.gateway.callsTo('sendMessage').filter((c) => c.args[0] === ex.teamChannelId);
    const debrief = JSON.stringify(posts.at(-1)!.args[1]);
    expect(debrief).toContain('EXERCISE REVEALED');
    expect(debrief).toContain('7/10');
    expect(debrief).toContain('FICTIONAL DATA ONLY');
    expect((await roleRow(bot, ex.roleId)).debriefDelivery).toBe('sent');
  });
});
