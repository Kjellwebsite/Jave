import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  adversarialRoles,
  adversarialScenarios,
  jobs,
  members,
  notifications,
} from '@jave/database';
import { adversarial, trials, updateSettings } from '@jave/core';
import { DiscordActionError } from '../../discord/gateway';
import type { IncomingMessage } from '../../gateway-events/types';
import { customId } from '../../interactions/custom-id';
import type { FakeInteraction } from '../../testing/fake-interaction';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import {
  activeTrial,
  as,
  configureDiscord,
  HOOK_TIMEOUT_MS,
  type Person,
  people,
  pace,
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
async function exercise(
  bot: BotHarness,
  options: { withTrigger?: boolean } = {},
): Promise<Exercise> {
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
  if (options.withTrigger)
    await adversarial.addTrigger(as(bot, planner!), {
      roleId: role.id,
      label: 'Urgent request',
      description: 'Post the fictional urgent request from the scenario in the team channel.',
    });
  const reviewed = await adversarial.getRole(as(bot, authorizer!), { roleId: role.id });
  await adversarial.authorizeRole(as(bot, authorizer!), {
    roleId: role.id,
    planRevision: reviewed.role.planRevision,
    sandboxAttested: true,
  });
  await adversarial.briefRole(as(bot, planner!), { roleId: role.id });
  await adversarial.activateRole(as(bot, planner!), { roleId: role.id });
  await bot.drain();
  const staff = await trials.getTrialForStaff(as(bot, planner!), { trialId });
  const teamChannelId = staff.teams.find((t) => t.id === operativeTeam.id)!.discordChannelId!;
  return {
    trialId,
    roleId: role.id,
    operative,
    teammate,
    otherTeam,
    teamChannelId,
    planner: planner!,
    authorizer: authorizer!,
  };
}

/** Words that would tell a participant their trial hosts a hidden role. */
const ADVERSARIAL_TELLS =
  /adversar|operative|red[\s_-]?flag|sandbox|security.culture|two-person|stop word|exercise/i;

/** The visible shape of a set of replies: titles (refs normalized), field names, control labels. */
function shape(interaction: FakeInteraction): string {
  return JSON.stringify(
    interaction.responses.map((response) => {
      if (!('payload' in response)) return response.type;
      const payload = response.payload;
      return {
        embeds: (payload.embeds ?? []).map((embed) => ({
          title: (embed.title ?? '').replace(/TRIAL-\d+/g, 'TRIAL-N').replace(/USER\d+/g, 'USER'),
          fields: (embed.fields ?? []).map((f) => f.name.replace(/TRIAL-\d+/g, 'TRIAL-N')),
        })),
        controls: (
          (payload.components ?? []) as {
            components: { label?: string; custom_id?: string }[];
          }[]
        ).flatMap((row) =>
          row.components.map((c) => c.label ?? c.custom_id?.split(':').slice(0, 2).join(':')),
        ),
      };
    }),
  );
}

/** A channel of the server that belongs to no team. */
const GENERAL_CHANNEL = '930000000000000099';

function stopWordMessage(
  bot: BotHarness,
  channelId: string,
  author: Person,
  content: string,
): IncomingMessage {
  return {
    id: '930000000000000001',
    channelId,
    guildId: bot.gateway.guildId,
    parentChannelId: null,
    isThread: false,
    author: {
      id: author.user.id,
      username: author.user.username,
      globalName: null,
      avatar: null,
      bot: false,
    },
    authorRoleIds: [],
    content,
    mentionCount: 0,
    mentionsEveryone: false,
    attachments: [],
    createdAt: bot.kit.clock.now(),
    url: 'https://discord.com/channels/x',
  };
}

async function alertsFor(bot: BotHarness, person: Person) {
  const rows = await bot.kit.db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, person.actor.userId));
  return rows.filter((n) => n.type === 'adversarial.alert');
}

async function roleRow(bot: BotHarness, roleId: string) {
  const [row] = await bot.kit.db
    .select()
    .from(adversarialRoles)
    .where(eq(adversarialRoles.id, roleId));
  return row!;
}

describe('adversarial: Discord surface', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = pace(await createBotHarness());
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT_MS);

  it('briefing DM carries every section; never a guild post; delivery is recorded', async () => {
    const ex = await exercise(bot);
    const dms = bot.gateway.dms.filter((dm) => dm.userId === ex.operative.actor.discordId);
    const briefing = JSON.stringify(dms.map((dm) => dm.payload));
    for (const section of [
      'OBJECTIVE',
      'SANDBOX ASSETS',
      'TRIGGERS',
      'GUARDRAILS',
      'OPERATING RULES',
      'STOP PROTOCOL',
      'RED FLAG',
    ])
      expect(briefing).toContain(section);
    expect(briefing).toContain('FICTIONAL DATA ONLY');
    // JAVE never reads DMs: the stop control travels with the briefing, under its last message.
    const withControls = dms.filter((dm) => JSON.stringify(dm.payload.components ?? []).length > 2);
    expect(withControls).toHaveLength(1);
    expect(JSON.stringify(withControls[0]!.payload)).toContain('STOP PROTOCOL');
    expect(JSON.stringify(withControls[0]!.payload.components)).toContain(
      customId('adversarial', 'redflag', ex.roleId),
    );
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
      .where(
        and(
          eq(notifications.recipientUserId, ex.planner.actor.userId),
          eq(notifications.type, 'adversarial.staff'),
        ),
      );
    expect(planner.some((n) => n.title.startsWith('BRIEFING NOT DELIVERED'))).toBe(true);
  });

  it('/trial briefing: the operative sees their briefing; everyone else gets the identical no-briefing answer', async () => {
    const ex = await exercise(bot);
    const mine = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'briefing',
      user: ex.operative.user,
    });
    const text = JSON.stringify(mine.interaction.responses);
    expect(text).toContain('GUARDRAILS');
    expect(text).toContain(customId('adversarial', 'redflag', ex.roleId));
    expect(mine.interaction.lastPayload()!.ephemeral).toBe(true);

    const expected = JSON.stringify(noBriefingReply());
    const [outsider] = await people(bot, 1, ['verified']);
    const [staffer] = await people(bot, 1, ['founder']);
    for (const person of [ex.teammate, ex.otherTeam, outsider!, staffer!]) {
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'trial',
        subcommand: 'briefing',
        user: person.user,
      });
      expect(JSON.stringify(interaction.lastPayload())).toBe(expected);
    }
    // A quarantined operative is indistinguishable from nobody.
    await bot.kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, ex.operative.actor.memberId!));
    const quarantined = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'briefing',
      user: ex.operative.user,
    });
    expect(JSON.stringify(quarantined.interaction.lastPayload())).toBe(expected);
  });

  it('RED FLAG: one press stops the exercise; STOP DM without the reason; forged presses look like nothing', async () => {
    const ex = await exercise(bot);
    const forged = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag', ex.roleId),
      user: ex.teammate.user,
    });
    const random = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag', '00000000-0000-4000-8000-000000000000'),
      user: ex.teammate.user,
    });
    const garbage = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag', 'not-a-role'),
      user: ex.teammate.user,
    });
    const trigger = await bot.run({
      kind: 'select',
      name: customId('adversarial', 'fire', ex.roleId),
      values: ['00000000-0000-4000-8000-000000000001'],
      user: ex.teammate.user,
    });
    const expected = JSON.stringify(noBriefingReply());
    for (const attempt of [forged, random, garbage, trigger])
      expect(JSON.stringify(attempt.interaction.lastPayload())).toBe(expected);
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');

    const raise = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag', ex.roleId),
      user: ex.operative.user,
    });
    expect(raise.interaction.lastText()).toContain('EXERCISE STOPPED');
    expect(raise.interaction.lastPayload()!.ephemeral).toBe(true);
    await bot.drain();
    const role = await roleRow(bot, ex.roleId);
    expect(role).toMatchObject({ status: 'aborted', stopNoticeDelivery: 'sent' });
    const stop = bot.gateway.dms.filter(
      (dm) =>
        dm.userId === ex.operative.actor.discordId &&
        JSON.stringify(dm.payload).includes('STOP — EXERCISE ENDED'),
    );
    expect(stop).toHaveLength(1);
    expect(JSON.stringify(stop[0]!.payload)).not.toContain('Raised by the operative');
    // Idempotent: a second press reports the exercise as already stopped.
    const again = await bot.run({
      kind: 'button',
      name: customId('adversarial', 'redflag', ex.roleId),
      user: ex.operative.user,
    });
    expect(again.interaction.lastText()).toContain('already stopped');
  });

  it('RED FLAG pressed in the briefing DM stops the exercise; nobody else can use a DM press', async () => {
    const ex = await exercise(bot);
    const inDm = (person: Person) =>
      bot.run({
        kind: 'button',
        name: customId('adversarial', 'redflag', ex.roleId),
        user: person.user,
        guildId: null,
      });
    const teammate = await inDm(ex.teammate);
    expect(JSON.stringify(teammate.interaction.lastPayload())).toBe(
      JSON.stringify(noBriefingReply()),
    );
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');

    const pressed = await inDm(ex.operative);
    expect(pressed.outcome.outcome).toBe('ok');
    expect(pressed.interaction.lastText()).toContain('EXERCISE STOPPED');
    await bot.drain();
    const role = await roleRow(bot, ex.roleId);
    expect(role).toMatchObject({ status: 'aborted', stopNoticeDelivery: 'sent' });
    expect(role.redFlagRaisedByUserId).toBe(ex.operative.actor.userId);
    const alerts = await bot.kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientUserId, ex.authorizer.actor.userId));
    expect(alerts.some((n) => n.type === 'adversarial.alert')).toBe(true);
  });

  it('operative marks a planned trigger as carried out from the briefing', async () => {
    const ex = await exercise(bot, { withTrigger: true });
    const briefing = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'briefing',
      user: ex.operative.user,
    });
    const text = JSON.stringify(briefing.interaction.responses);
    expect(text).toContain(customId('adversarial', 'fire', ex.roleId));
    const role = await adversarial.getRole(as(bot, ex.planner), { roleId: ex.roleId });
    const triggerId = role.triggers[0]!.id;
    const fired = await bot.run({
      kind: 'select',
      name: customId('adversarial', 'fire', ex.roleId),
      values: [triggerId],
      user: ex.operative.user,
    });
    expect(fired.interaction.lastText()).toContain('TRIGGER RECORDED');
    const twice = await bot.run({
      kind: 'select',
      name: customId('adversarial', 'fire', ex.roleId),
      values: [triggerId],
      user: ex.operative.user,
    });
    expect(twice.interaction.lastText()).toContain('already fired');
  });

  it('BREAK: no participant-facing command, card, DM or error reveals that a trial hosts a role', async () => {
    const ex = await exercise(bot, { withTrigger: true });
    // A twin trial without any hidden role, with the same participants' counterparts.
    const [manager] = await people(bot, 1, ['operations']);
    const twins = await people(bot, 4, ['verified']);
    const plain = await activeTrial(bot, manager!, twins, { teamSize: 2 });
    await bot.drain();
    const twin = twins.find((p) =>
      plain.assignment.teams[0]!.memberIds.includes(p.actor.memberId!),
    )!;

    async function battery(person: Person, trialId: string) {
      const runs = [
        await bot.run({ kind: 'slash', name: 'trial', subcommand: 'list', user: person.user }),
        await bot.run({
          kind: 'slash',
          name: 'trial',
          subcommand: 'view',
          user: person.user,
          options: { trial: trialId },
        }),
        await bot.run({ kind: 'slash', name: 'trial', subcommand: 'status', user: person.user }),
        await bot.run({ kind: 'slash', name: 'team', user: person.user }),
        await bot.run({
          kind: 'button',
          name: customId('trials', 'submit', trialId),
          user: person.user,
        }),
        await bot.run({
          kind: 'button',
          name: customId('trials', 'panel', trialId),
          user: person.user,
        }),
        await bot.run({
          kind: 'user_context',
          name: 'Trial Record',
          user: person.user,
          targetUser: person.user,
        }),
      ];
      return runs.map((run) => run.interaction);
    }

    for (const person of [ex.teammate, ex.otherTeam]) {
      const interactions = await battery(person, ex.trialId);
      for (const interaction of interactions)
        expect(JSON.stringify(interaction.responses), interaction.name).not.toMatch(
          ADVERSARIAL_TELLS,
        );
      const briefing = await bot.run({
        kind: 'slash',
        name: 'trial',
        subcommand: 'briefing',
        user: person.user,
      });
      expect(JSON.stringify(briefing.interaction.lastPayload())).toBe(
        JSON.stringify(noBriefingReply()),
      );
    }

    // Same shapes as the twin trial without a role: nothing extra, nothing missing.
    const withRole = await battery(ex.teammate, ex.trialId);
    const withoutRole = await battery(twin, plain.trialId);
    for (const [index, interaction] of withRole.entries())
      expect(shape(interaction), interaction.name).toBe(shape(withoutRole[index]!));

    // Cards, channel posts and every DM to a participant other than the operative.
    const posts = bot.gateway.callsTo('sendMessage').map((call) => call.args[1]);
    expect(JSON.stringify(posts)).not.toMatch(ADVERSARIAL_TELLS);
    const participants = new Set(
      [ex.teammate, ex.otherTeam, ...twins].map((person) => person.actor.discordId),
    );
    const toParticipants = bot.gateway.dms.filter((dm) => participants.has(dm.userId));
    expect(toParticipants.length).toBeGreaterThan(0);
    expect(JSON.stringify(toParticipants)).not.toMatch(ADVERSARIAL_TELLS);
  });

  it('stop word: a participant’s words alert managers and stop nothing; nothing is posted', async () => {
    expect(mentionsStopWord('ok RED FLAG now')).toBe(true);
    expect(mentionsStopWord('red-flag')).toBe(true);
    expect(mentionsStopWord('redflagged')).toBe(false);
    expect(mentionsStopWord('the red flags we saw')).toBe(false);
    const ex = await exercise(bot);
    const posted = bot.gateway.callsTo('sendMessage').length;
    const team = new Set([ex.operative, ex.teammate].map((person) => person.actor.discordId));
    const dmsToTeam = () => bot.gateway.dms.filter((dm) => team.has(dm.userId)).length;
    const dmsBefore = dmsToTeam();
    // Red Flag Hunt vocabulary, and the detection a team should make.
    await bot.app.events.message(
      stopWordMessage(bot, ex.teamChannelId, ex.teammate, 'found a red flag in the access policy'),
    );
    await bot.app.events.message(
      stopWordMessage(bot, ex.teamChannelId, ex.teammate, 'red flag — someone asked for the key'),
    );
    await bot.settle();
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(posted);
    // No STOP for the operative, nothing for the team; only managers hear of it (by DM).
    expect(dmsToTeam()).toBe(dmsBefore);
    expect(
      bot.gateway.dms.some(
        (dm) =>
          dm.userId === ex.planner.actor.discordId &&
          JSON.stringify(dm.payload).includes('STOP WORD IN CHAT'),
      ),
    ).toBe(true);
    const alerts = await alertsFor(bot, ex.planner);
    expect(alerts.map((a) => a.title)).toEqual([expect.stringMatching(/^STOP WORD IN CHAT/)]);
    expect(await alertsFor(bot, ex.teammate)).toEqual([]);
    expect(await alertsFor(bot, ex.operative)).toEqual([]);
  });

  it('stop word: the operative typing it anywhere in the server stops the exercise, attributed to them', async () => {
    const ex = await exercise(bot);
    const posted = bot.gateway.callsTo('sendMessage').length;
    await bot.app.events.message(stopWordMessage(bot, GENERAL_CHANNEL, ex.operative, 'RED FLAG'));
    await bot.settle();
    const role = await roleRow(bot, ex.roleId);
    expect(role.status).toBe('aborted');
    expect(role.redFlagRaisedByUserId).toBe(ex.operative.actor.userId);
    expect(role.abortReason).toContain('typed in chat by the operative');
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(posted);
    expect(
      bot.gateway.dms.some(
        (dm) =>
          dm.userId === ex.operative.actor.discordId && JSON.stringify(dm.payload).includes('STOP'),
      ),
    ).toBe(true);
    const [alert] = await alertsFor(bot, ex.authorizer);
    expect(alert!.body).toContain('typed in chat by the operative');
    expect(alert!.body).not.toContain('by staff');
  });

  it('stop word: adversarial staff in the team channel (or a thread of it) stop the exercise', async () => {
    const ex = await exercise(bot);
    await bot.app.events.message(stopWordMessage(bot, GENERAL_CHANNEL, ex.planner, 'RED FLAG'));
    await bot.settle();
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');
    await bot.app.events.message({
      ...stopWordMessage(bot, '930000000000000077', ex.planner, 'RED FLAG'),
      isThread: true,
      parentChannelId: ex.teamChannelId,
    });
    await bot.settle();
    const role = await roleRow(bot, ex.roleId);
    expect(role.status).toBe('aborted');
    expect(role.redFlagRaisedByUserId).toBe(ex.planner.actor.userId);
    expect(role.abortReason).toContain('typed in chat by staff');
  });

  it('BREAK: messages from bots, other guilds or without the words never reach core', async () => {
    const ex = await exercise(bot);
    const base = stopWordMessage(bot, ex.teamChannelId, ex.operative, 'RED FLAG');
    await bot.app.events.message({ ...base, author: { ...base.author, bot: true } });
    await bot.app.events.message({ ...base, guildId: '100000000000000111' });
    await bot.app.events.message({ ...base, guildId: null });
    await bot.app.events.message({ ...base, content: 'the red flags we saw' });
    await bot.settle();
    expect((await roleRow(bot, ex.roleId)).status).toBe('active');
    expect(await alertsFor(bot, ex.planner)).toEqual([]);
  });

  it('BREAK: an undeliverable STOP on the last attempt raises a critical alert', async () => {
    const ex = await exercise(bot);
    await adversarial.abortRole(as(bot, ex.planner), {
      roleId: ex.roleId,
      reason: 'Scenario leaked.',
    });
    await bot.kit.db
      .update(jobs)
      .set({ attempts: adversarial.ABORT_MAX_ATTEMPTS - 1 })
      .where(eq(jobs.type, adversarial.ADVERSARIAL_ABORT_JOB));
    bot.gateway.failures.set(
      'sendDirectMessage',
      new DiscordActionError('gateway down', 503, false),
    );
    await bot.drain();
    expect((await roleRow(bot, ex.roleId)).stopNoticeDelivery).toBe('undeliverable');
    const alerts = await bot.kit.db
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'adversarial.alert'));
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
