import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, missions as missionsTable } from '@jave/database';
import { missions, updateSettings, type UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';
import { customId } from '../../interactions/custom-id';
import { BRIEF, CHANNEL, jobStatuses, SUITE_TIMEOUTS } from './testing/fixtures';

vi.setConfig(SUITE_TIMEOUTS);

const OTHER_MESSAGE = '400000000000000077';
const { DISCORD_MISSION_ANNOUNCE_JOB: ANNOUNCE, DISCORD_MISSION_REFRESH_CARD_JOB: REFRESH } =
  missions;

function buttonIds(payload: MessagePayload): string[] {
  return (payload.components ?? []).flatMap((row) =>
    row.components.map((component) => ('custom_id' in component ? component.custom_id : '')),
  );
}

describe('mission Discord jobs', () => {
  let bot: BotHarness;
  let ops: UserActor;

  beforeEach(async () => {
    bot = await createBotHarness();
    ops = (await bot.member({ roles: ['operations'] })).actor;
    await updateSettings(bot.kit.system, 'channels', { missions: CHANNEL });
  });
  afterEach(async () => {
    await bot.close();
  });

  async function publish(overrides: Partial<Parameters<typeof missions.createMission>[1]> = {}) {
    const draft = await missions.createMission(bot.kit.as(ops), {
      title: 'Prototype sprint',
      brief: BRIEF,
      type: 'build',
      maxAssignees: 1,
      ...overrides,
    });
    await missions.publishMission(bot.kit.as(ops), { missionId: draft.id });
    return draft;
  }

  async function stored(id: string) {
    const [row] = await bot.kit.db.select().from(missionsTable).where(eq(missionsTable.id, id));
    return row!;
  }

  it('posts the card with ACCEPT, records it, and refreshes it as slots and state change', async () => {
    const mission = await publish();
    await bot.drain();
    const [post] = bot.gateway.callsTo('sendMessage');
    expect(post?.args[0]).toBe(CHANNEL);
    const card = post!.args[1] as MessagePayload;
    expect(card.embeds![0]!.author?.name).toBe('MISSION M-0001 · BUILD · OPEN');
    expect(card.embeds![0]!.title).toBe('PROTOTYPE SPRINT');
    expect(buttonIds(card)).toEqual([
      missions.missionAcceptCustomId(mission.id),
      customId('missions', 'view', mission.id),
    ]);
    const messageId = [...bot.gateway.messages.keys()][0]!;
    expect((await stored(mission.id)).announcementMessageId).toBe(messageId);

    // The one slot is taken from the card: the card refreshes without ACCEPT.
    const member = await bot.member({ roles: ['verified'] });
    const accepted = await bot.run({
      kind: 'button',
      name: missions.missionAcceptCustomId(mission.id),
      user: member.user,
    });
    expect(accepted.interaction.lastPayload()!.ephemeral).toBe(true);
    await bot.drain();
    const edited = bot.gateway.messages.get(messageId)!.payload;
    expect(buttonIds(edited)).toEqual([customId('missions', 'view', mission.id)]);
    expect(edited.embeds![0]!.footer?.text).toBe('Every slot is taken.');

    await missions.closeMission(bot.kit.as(ops), { missionId: mission.id });
    await bot.drain();
    const closed = bot.gateway.messages.get(messageId)!.payload;
    expect(closed.embeds![0]!.author?.name).toContain('CLOSED');
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual(['completed']);
  });

  it('queues nothing without a channel and posts nothing for a mission closed meanwhile', async () => {
    await updateSettings(bot.kit.system, 'channels', {
      missions: undefined,
      announcements: undefined,
    });
    await publish();
    await bot.drain();
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual([]);

    await updateSettings(bot.kit.system, 'channels', { missions: CHANNEL });
    const mission = await publish({ title: 'Second sprint' });
    await missions.closeMission(bot.kit.as(ops), { missionId: mission.id });
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual(['completed']);
  });

  it('dead-letters on missing permissions and retries a rate limit', async () => {
    await publish();
    bot.gateway.failures.set(
      'sendMessage',
      new DiscordActionError('send message failed: Missing Permissions', 50013, true),
    );
    await bot.drain();
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual(['dead']);

    await publish({ title: 'Second sprint' });
    bot.gateway.failures.set('sendMessage', new DiscordActionError('rate limited', 429, false));
    await bot.drain();
    const [retrying] = await bot.kit.db.select().from(jobs).where(eq(jobs.status, 'pending'));
    expect(retrying?.type).toBe(ANNOUNCE);
    bot.kit.clock.advance(60_000);
    await bot.drain();
    expect((await jobStatuses(bot, ANNOUNCE)).sort()).toEqual(['completed', 'dead']);
    expect(bot.gateway.messages.size).toBe(1);
  });

  it('deletes its card when another attempt already announced', async () => {
    const mission = await publish();
    const send = bot.gateway.sendMessage.bind(bot.gateway);
    bot.gateway.sendMessage = async (channelId, payload) => {
      await missions.markMissionAnnounced(bot.kit.system, {
        missionId: mission.id,
        channelId,
        messageId: OTHER_MESSAGE,
      });
      return send(channelId, payload);
    };
    await bot.drain();
    expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(1);
    expect(bot.gateway.messages.size).toBe(0);
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual(['completed']);
  });

  it('refreshes a card closed while it was posting, and leaves a deleted card alone', async () => {
    const mission = await publish();
    const send = bot.gateway.sendMessage.bind(bot.gateway);
    bot.gateway.sendMessage = async (channelId, payload) => {
      const sent = await send(channelId, payload);
      await missions.closeMission(bot.kit.as(ops), { missionId: mission.id });
      return sent;
    };
    await bot.drain();
    const [messageId] = [...bot.gateway.messages.keys()];
    const card = bot.gateway.messages.get(messageId!)!.payload;
    expect(card.embeds![0]!.author?.name).toContain('CLOSED');
    expect(buttonIds(card)).not.toContain(missions.missionAcceptCustomId(mission.id));

    bot.gateway.messages.clear();
    await missions.reopenMission(bot.kit.as(ops), { missionId: mission.id });
    await bot.drain();
    expect((await jobStatuses(bot, REFRESH)).every((status) => status === 'completed')).toBe(true);
  });

  it('BREAK: forged payloads dead-letter without touching Discord', async () => {
    const runAt = bot.kit.clock.now();
    await bot.kit.db.insert(jobs).values([
      { type: ANNOUNCE, runAt, payload: { missionId: 'nope', channelId: CHANNEL } },
      {
        type: ANNOUNCE,
        runAt,
        payload: { missionId: '00000000-0000-4000-8000-000000000000', channelId: '@everyone' },
      },
      { type: REFRESH, runAt, payload: { missionId: 42 } },
    ]);
    await bot.drain();
    expect(await jobStatuses(bot, ANNOUNCE)).toEqual(['dead', 'dead']);
    expect(await jobStatuses(bot, REFRESH)).toEqual(['dead']);
    expect(bot.gateway.calls.filter((call) => call.method !== 'fetchMember')).toHaveLength(0);
  });
});
