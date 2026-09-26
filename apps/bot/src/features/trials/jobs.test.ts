import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, trials as trialsTable, trialTeams } from '@jave/database';
import { enqueueJob, MINUTE, trials, updateSettings } from '@jave/core';
import type { APIEmbed } from 'discord.js';
import { DiscordActionError, type PermissionOverwriteSpec } from '../../discord/gateway';
import { createBotHarness, TEST_CLIENT_ID, TEST_GUILD_ID, type BotHarness } from '../../testing/harness';
import { embedTextLength, MESSAGE_EMBED_TEXT_LIMIT } from './render/text';
import {
  activeTrial,
  ANNOUNCEMENTS_CHANNEL,
  as,
  assignedTrial,
  configureDiscord,
  HOOK_TIMEOUT_MS,
  OPERATIONS_ROLE,
  people,
  recruitingTrial,
  SUITE,
  TRIALS_CATEGORY,
} from './test-fixtures';

describe('trials: Discord job handlers', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await createBotHarness();
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT_MS);

  async function jobsOf(type: string) {
    return bot.kit.db.select().from(jobs).where(eq(jobs.type, type));
  }
  async function teamsOf(trialId: string) {
    return bot.kit.db.select().from(trialTeams).where(eq(trialTeams.trialId, trialId));
  }
  function sentTo(channelId: string) {
    return bot.gateway.callsTo('sendMessage').filter((call) => call.args[0] === channelId);
  }
  function embedsOf(call: { args: unknown[] }): APIEmbed[] {
    return ((call.args[1] ?? call.args[2]) as { embeds?: APIEmbed[] }).embeds ?? [];
  }

  it('announce: posts the card with APPLY, edits it when recruitment closes, re-posts a deleted card', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const applicants = await people(bot, 2);
    const trialId = await recruitingTrial(bot, manager!, applicants);
    await bot.drain();

    const posted = sentTo(ANNOUNCEMENTS_CHANNEL);
    expect(posted).toHaveLength(1);
    const card = posted[0]!.args[1] as { embeds: APIEmbed[]; components: { components: { custom_id?: string; disabled?: boolean; label?: string }[] }[] };
    expect(card.embeds[0]!.title).toContain('NIGHT BUILD');
    expect(card.embeds[0]!.description).toContain('Outcomes count');
    const apply = card.components[0]!.components[0]!;
    expect(apply).toMatchObject({ custom_id: `trials:apply:${trialId}`, disabled: false, label: 'APPLY' });
    const [row] = await bot.kit.db.select().from(trialsTable).where(eq(trialsTable.id, trialId));
    expect(row!.announcementChannelId).toBe(ANNOUNCEMENTS_CHANNEL);
    const messageId = row!.announcementMessageId!;

    await trials.selectParticipants(as(bot, manager!), {
      trialId,
      mode: 'manual',
      memberIds: applicants.map((a) => a.actor.memberId!),
    });
    await trials.assignTeams(as(bot, manager!), { trialId, strategy: 'random', seed: 's' });
    await bot.drain();
    const edit = bot.gateway.callsTo('editMessage').at(-1)!;
    expect(edit.args[1]).toBe(messageId);
    const edited = edit.args[2] as typeof card;
    expect(edited.components[0]!.components[0]).toMatchObject({ disabled: true, label: 'RECRUITMENT CLOSED' });

    // Someone deletes the card by hand: the next refresh posts a new one and records it.
    bot.gateway.messages.delete(messageId);
    await trials.cancelTrial(as(bot, manager!), { trialId, reason: 'Venue lost.' });
    await bot.drain();
    const [after] = await bot.kit.db.select().from(trialsTable).where(eq(trialsTable.id, trialId));
    expect(after!.announcementMessageId).not.toBe(messageId);
    expect(bot.gateway.messages.get(after!.announcementMessageId!)).toBeDefined();
    const final = bot.gateway.messages.get(after!.announcementMessageId!)!.payload as typeof card;
    expect(final.components[0]!.components[0]).toMatchObject({ disabled: true, label: 'CANCELLED' });
  });

  it('announce: skips quietly without an announcements channel', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    await recruitingTrial(bot, manager!, []);
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    const announce = await jobsOf(trials.DISCORD_TRIALS_ANNOUNCE_JOB);
    expect(announce.every((job) => job.status === 'completed')).toBe(true);
  });

  it('provision: private channels with exact overwrites; re-syncs on withdrawal; recreates a deleted channel', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 3);
    const [staffPlayer] = await people(bot, 1, ['operations']);
    const everyone = [...players, staffPlayer!];
    const { trialId, assignment } = await assignedTrial(bot, manager!, everyone);
    await bot.drain();

    const created = bot.gateway.callsTo('createTextChannel');
    expect(created).toHaveLength(assignment.teams.length);
    const teams = await teamsOf(trialId);
    expect(teams.every((team) => team.discordChannelId)).toBe(true);

    const staffTeam = assignment.teams.find((t) => t.memberIds.includes(staffPlayer!.actor.memberId!))!;
    const otherTeam = assignment.teams.find((t) => t.id !== staffTeam.id)!;
    const otherRow = teams.find((t) => t.id === otherTeam.id)!;
    const channel = bot.gateway.channels.get(otherRow.discordChannelId!)!;
    expect(channel.parentId).toBe(TRIALS_CATEGORY);
    expect(channel.name).toMatch(/^trial-\d{4}-unit-(alpha|bravo)$/);
    const byId = new Map(channel.overwrites.map((o) => [o.id, o]));
    expect(byId.get(TEST_GUILD_ID)).toMatchObject({ type: 'role', deny: ['ViewChannel'] });
    expect(byId.get(TEST_CLIENT_ID)?.allow).toEqual(
      expect.arrayContaining(['ViewChannel', 'SendMessages', 'EmbedLinks']),
    );
    expect(byId.get(OPERATIONS_ROLE)).toMatchObject({ type: 'role' });
    expect(byId.get(OPERATIONS_ROLE)!.allow).toContain('ViewChannel');
    // The operations member competes on the other team: explicitly denied here.
    expect(byId.get(staffPlayer!.actor.discordId)).toMatchObject({ type: 'member', deny: ['ViewChannel'] });
    const memberDiscordIds = everyone
      .filter((p) => otherTeam.memberIds.includes(p.actor.memberId!))
      .map((p) => p.actor.discordId);
    for (const id of memberDiscordIds) expect(byId.get(id)?.allow).toContain('SendMessages');

    // A member withdraws before the start: the channel loses them.
    const leaver = everyone.find((p) => p.actor.discordId === memberDiscordIds[0])!;
    await trials.withdraw(as(bot, leaver), { trialId });
    await bot.drain();
    const resynced = bot.gateway.callsTo('setChannelOverwrites').at(-1)!;
    expect(resynced.args[0]).toBe(otherRow.discordChannelId);
    const ids = (resynced.args[1] as PermissionOverwriteSpec[]).map((o) => o.id);
    expect(ids).not.toContain(leaver.actor.discordId);

    // The channel was deleted by hand: re-sync recreates it and records the new id.
    bot.gateway.failures.set('setChannelOverwrites', new DiscordActionError('Unknown Channel', 10003, true));
    await trials.reprovisionTeams(as(bot, manager!), { trialId });
    await bot.drain();
    const recreatedRows = await teamsOf(trialId);
    const ids2 = recreatedRows.map((t) => t.discordChannelId);
    expect(new Set(ids2).size).toBe(recreatedRows.length);
    expect(bot.gateway.callsTo('createTextChannel').length).toBe(assignment.teams.length + 1);
  });

  it('provision: team roles hold exactly the roster', async () => {
    await configureDiscord(bot);
    await updateSettings(bot.kit.system, 'trials', { createTeamRoles: true });
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    await bot.drain();
    const [team] = await teamsOf(trialId);
    expect(team!.discordRoleId).toBeTruthy();
    for (const p of players)
      expect(bot.gateway.members.get(p.actor.discordId)!.roleIds).toContain(team!.discordRoleId);
    await trials.withdraw(as(bot, players[0]!), { trialId });
    await bot.drain();
    expect(bot.gateway.members.get(players[0]!.actor.discordId)!.roleIds).not.toContain(team!.discordRoleId);
    expect(bot.gateway.members.get(players[1]!.actor.discordId)!.roleIds).toContain(team!.discordRoleId);
  });

  it('BREAK: missing category dead-letters; a Discord permission error is permanent; unreported channels are removed', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    await bot.drain();
    expect(bot.gateway.callsTo('createTextChannel')).toHaveLength(0);
    const dead = (await jobsOf(trials.DISCORD_TRIALS_PROVISION_JOB)).filter((j) => j.status === 'dead');
    expect(dead).toHaveLength(1);
    expect(dead[0]!.lastError).toContain('trialsCategory');

    await configureDiscord(bot);
    bot.gateway.failures.set(
      'createTextChannel',
      new DiscordActionError('Missing Permissions', 50013, true),
    );
    await trials.reprovisionTeams(as(bot, manager!), { trialId });
    await bot.drain();
    expect((await jobsOf(trials.DISCORD_TRIALS_PROVISION_JOB)).filter((j) => j.status === 'dead')).toHaveLength(2);
    // One refused attempt, nothing created, nothing recorded.
    expect(bot.gateway.callsTo('createTextChannel')).toHaveLength(1);
    expect(bot.gateway.channels.size).toBe(0);
    expect((await teamsOf(trialId)).every((t) => t.discordChannelId === null)).toBe(true);
  });

  it('BREAK: resources created before a transient failure are removed, so the retry never duplicates them', async () => {
    await configureDiscord(bot);
    await updateSettings(bot.kit.system, 'trials', { createTeamRoles: true });
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    await bot.drain(); // role sync of the fixtures' own grants
    bot.gateway.failures.set('addRoles', new DiscordActionError('gateway hiccup', 500, false));
    const { trialId } = await assignedTrial(bot, manager!, players);
    await bot.drain();
    const firstRole = bot.gateway.callsTo('createRole')[0]!;
    expect(firstRole).toBeDefined();
    expect(bot.gateway.callsTo('deleteRole')).toHaveLength(1);
    const [provision] = await jobsOf(trials.DISCORD_TRIALS_PROVISION_JOB);
    expect(provision).toMatchObject({ status: 'pending', attempts: 1 });

    bot.kit.clock.advance(10 * MINUTE);
    await bot.drain();
    const [team] = await teamsOf(trialId);
    expect(bot.gateway.callsTo('createRole')).toHaveLength(2);
    expect(bot.gateway.callsTo('createTextChannel')).toHaveLength(1);
    for (const p of players)
      expect(bot.gateway.members.get(p.actor.discordId)!.roleIds).toEqual([team!.discordRoleId]);
  });

  it('provision: a team reshuffled away mid-run gets its fresh channel deleted', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    const createChannel = bot.gateway.createTextChannel.bind(bot.gateway);
    let reshuffled = false;
    bot.gateway.createTextChannel = async (spec) => {
      const id = await createChannel(spec);
      if (!reshuffled) {
        reshuffled = true;
        await trials.assignTeams(as(bot, manager!), { trialId, strategy: 'random', seed: 'again' });
      }
      return id;
    };
    await bot.drain();
    const deleted = bot.gateway.callsTo('deleteChannel').map((call) => call.args[0]);
    expect(deleted).toHaveLength(1);
    const [team] = await teamsOf(trialId);
    expect(team!.discordChannelId).toBeTruthy();
    expect(deleted).not.toContain(team!.discordChannelId);
  });

  it('brief, warnings and archive: posted in team channels, never clipped, then locked read-only', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 4);
    const longBrief = Array.from({ length: 120 }, (_, i) => `- Step ${i}: ship [it] (fast) #${i} @everyone`).join('\n');
    const { trialId } = await assignedTrial(bot, manager!, players, { brief: longBrief });
    await bot.drain();
    await trials.startTrial(as(bot, manager!), { trialId });
    await bot.drain();

    const teams = await teamsOf(trialId);
    expect(teams.every((t) => t.briefedAt)).toBe(true);
    for (const team of teams) {
      const posts = sentTo(team.discordChannelId!);
      expect(posts.length).toBeGreaterThan(1);
      for (const post of posts) {
        const size = embedsOf(post).reduce((sum, embed) => sum + embedTextLength(embed), 0);
        expect(size).toBeLessThanOrEqual(MESSAGE_EMBED_TEXT_LIMIT);
      }
      const text = posts.map((p) => JSON.stringify(embedsOf(p))).join('');
      expect(text).toContain('Step 119');
      expect(text).toContain('WORKING PRODUCT · 75%');
      expect(text).not.toMatch(/(?<!​)@everyone/);
      const last = posts.at(-1)!.args[1] as { components: { components: { custom_id: string }[] }[] };
      expect(last.components[0]!.components[0]!.custom_id).toBe(`trials:submit:${trialId}`);
    }

    // Deadline warning in every team channel.
    bot.kit.clock.advance(61 * MINUTE);
    await bot.drain();
    for (const team of teams) {
      const warning = sentTo(team.discordChannelId!).at(-1)!;
      expect(JSON.stringify(embedsOf(warning))).toContain('remain');
    }

    // A transient failure on one team mid-archive: handled teams are recorded, the rest retried.
    await trials.cancelTrial(as(bot, manager!), { trialId, reason: 'Outage.' });
    bot.gateway.failures.set('renameChannel', new DiscordActionError('rate limited', 429, false));
    await bot.drain();
    let rows = await teamsOf(trialId);
    expect(rows.filter((t) => t.archivedAt)).toHaveLength(teams.length - 1);
    bot.kit.clock.advance(10 * MINUTE);
    await bot.drain();
    rows = await teamsOf(trialId);
    expect(rows.every((t) => t.archivedAt)).toBe(true);
    for (const team of rows) {
      const channel = bot.gateway.channels.get(team.discordChannelId!)!;
      expect(channel.name.startsWith('archived-')).toBe(true);
      const closings = sentTo(team.discordChannelId!).filter((p) =>
        JSON.stringify(embedsOf(p)).includes('TRIAL RECORD'),
      );
      expect(closings).toHaveLength(1);
      // Members read, never write; evaluator access is untouched.
      for (const overwrite of channel.overwrites.filter((o) => o.type === 'member' && o.id !== TEST_CLIENT_ID && !o.deny?.includes('ViewChannel')))
        expect(overwrite.deny).toEqual(expect.arrayContaining(['SendMessages', 'AddReactions']));
      expect(channel.overwrites.find((o) => o.id === OPERATIONS_ROLE)?.allow).toContain('ViewChannel');
    }
  });

  it('brief waits (retryable) while a channel is missing; teardown deletes reshuffled channels', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId, assignment } = await assignedTrial(bot, manager!, players);
    // No trials category yet: provisioning dead-letters and the channel never appears.
    await bot.drain();
    await bot.kit.db
      .update(trialsTable)
      .set({ status: 'active', deadlineAt: new Date(bot.kit.clock.now().getTime() + 60 * MINUTE) })
      .where(eq(trialsTable.id, trialId));
    await enqueueJob(bot.kit.system, trials.DISCORD_TRIALS_BRIEF_JOB, {
      trialId,
      teamId: assignment.teams[0]!.id,
    });
    await bot.drain();
    const [brief] = await jobsOf(trials.DISCORD_TRIALS_BRIEF_JOB);
    expect(brief).toMatchObject({ status: 'pending', attempts: 1 });
    expect(brief!.lastError).toContain('brief waits');

    await bot.kit.db
      .update(trialsTable)
      .set({ status: 'teams_assigned', deadlineAt: null })
      .where(eq(trialsTable.id, trialId));
    await configureDiscord(bot);
    await trials.reprovisionTeams(as(bot, manager!), { trialId });
    await bot.drain();
    const before = (await teamsOf(trialId)).map((t) => t.discordChannelId!);
    expect(before.every(Boolean)).toBe(true);
    await trials.assignTeams(as(bot, manager!), { trialId, strategy: 'balanced', seed: 'reshuffle' });
    await bot.drain();
    const deleted = bot.gateway.callsTo('deleteChannel').map((c) => c.args[0] as string);
    expect(deleted.sort()).toEqual([...before].sort());
    const teardown = await jobsOf(trials.DISCORD_TRIALS_TEARDOWN_JOB);
    expect(teardown.length).toBeGreaterThan(0);
    expect(teardown.every((j) => j.status === 'completed')).toBe(true);
  });
});
