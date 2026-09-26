import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { jobs, memberAchievements } from '@jave/database';
import { achievements, updateProfile, updateSettings, type UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { DiscordActionError, type MessagePayload } from '../../discord/gateway';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 240_000 });

const CHANNEL = '400000000000000001';
const OTHER_MESSAGE = '400000000000000077';
const { DISCORD_ACHIEVEMENT_ANNOUNCE_JOB: ANNOUNCE, DISCORD_ACHIEVEMENT_RETRACT_JOB: RETRACT } =
  achievements;

describe('achievement Discord jobs', () => {
  let bot: BotHarness;
  let ops: UserActor;
  let holder: UserActor;

  beforeEach(async () => {
    bot = await createBotHarness();
    ops = (await bot.member({ roles: ['operations'] })).actor;
    holder = (await bot.member({ roles: ['verified'], username: 'mara' })).actor;
    await achievements.seedStarterAchievements(bot.kit.system);
    await updateSettings(bot.kit.system, 'channels', { achievements: CHANNEL });
    await bot.drain();
  });
  afterEach(async () => {
    await bot.close();
  });

  /** Award through core (no interaction), leaving the announce job queued. */
  async function award(key = 'team_leader') {
    return achievements.awardAchievement(bot.kit.as(ops), {
      memberId: holder.memberId!,
      key,
      reason: 'Led team three through the build trial.',
    });
  }

  async function jobStatuses(type: string) {
    const rows = await bot.kit.db.select().from(jobs).where(eq(jobs.type, type));
    return rows.map((row) => row.status);
  }

  it('posts the unlock card once, with the mention inert, and records it', async () => {
    const record = await award();
    await bot.drain();
    const posts = bot.gateway.callsTo('sendMessage');
    expect(posts).toHaveLength(1);
    const message = posts[0]!.args[1] as MessagePayload;
    expect(message.content).toBe(`<@${holder.discordId}>`);
    expect(message.embeds![0]!.author?.name).toBe('NOTABLE · ACHIEVEMENT');
    expect(message.embeds![0]!.fields![0]!.value).toContain('@mara');
    const [row] = await bot.kit.db
      .select()
      .from(memberAchievements)
      .where(eq(memberAchievements.id, record.id));
    expect(row?.announcementChannelId).toBe(CHANNEL);
    expect(row?.announcementMessageId).toBe([...bot.gateway.messages.keys()][0]);
    expect(await jobStatuses(ANNOUNCE)).toEqual(['completed']);
  });

  it('posts nothing for hidden achievements, private profiles or revoked awards', async () => {
    await award('adversary');
    await updateProfile(bot.kit.as(holder), holder.memberId!, { profileVisibility: 'staff' });
    await award('team_leader');
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);

    await updateProfile(bot.kit.as(holder), holder.memberId!, { profileVisibility: 'members' });
    await award('first_trial');
    await achievements.revokeAchievement(bot.kit.as(ops), {
      memberId: holder.memberId!,
      key: 'first_trial',
      reason: 'Awarded in error.',
    });
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    expect(await jobStatuses(ANNOUNCE)).toEqual(['completed']);
  });

  it('dead-letters on a permanent Discord failure and retries a transient one', async () => {
    await award();
    bot.gateway.failures.set(
      'sendMessage',
      new DiscordActionError('send message failed: Missing Permissions', 50013, true),
    );
    await bot.drain();
    expect(await jobStatuses(ANNOUNCE)).toEqual(['dead']);

    await award('first_trial');
    bot.gateway.failures.set('sendMessage', new DiscordActionError('rate limited', 429, false));
    await bot.drain();
    const [retrying] = await bot.kit.db.select().from(jobs).where(eq(jobs.status, 'pending'));
    expect(retrying?.type).toBe(ANNOUNCE);
    bot.kit.clock.advance(60_000);
    await bot.drain();
    expect((await jobStatuses(ANNOUNCE)).sort()).toEqual(['completed', 'dead']);
    expect(bot.gateway.messages.size).toBe(1);
  });

  it('deletes its card when another attempt already announced', async () => {
    const record = await award();
    const send = bot.gateway.sendMessage.bind(bot.gateway);
    bot.gateway.sendMessage = async (channelId, payload) => {
      await achievements.markAchievementAnnounced(bot.kit.system, {
        memberAchievementId: record.id,
        channelId,
        messageId: OTHER_MESSAGE,
      });
      return send(channelId, payload);
    };
    await bot.drain();
    expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(1);
    expect(bot.gateway.messages.size).toBe(0);
    expect(await jobStatuses(ANNOUNCE)).toEqual(['completed']);
  });

  it('removes its card and retries when the report fails, then settles on the revocation', async () => {
    const record = await award();
    await bot.kit.db.execute(
      sql.raw(`create or replace function test_fail_retract() returns trigger
        language plpgsql as $$ begin raise exception 'injected failure'; end $$`),
    );
    await bot.kit.db.execute(
      sql.raw(`create trigger test_fail_retract before insert on jobs for each row
        when (new.type = '${RETRACT}') execute function test_fail_retract()`),
    );
    const send = bot.gateway.sendMessage.bind(bot.gateway);
    let revoked = false;
    bot.gateway.sendMessage = async (channelId, payload) => {
      const sent = await send(channelId, payload);
      if (!revoked) {
        revoked = true;
        await bot.kit.db
          .update(memberAchievements)
          .set({ revokedAt: bot.kit.clock.now(), revokeReason: 'Concurrent revocation.' })
          .where(eq(memberAchievements.id, record.id));
      }
      return sent;
    };
    await bot.drain();
    expect(bot.gateway.callsTo('deleteMessage')).toHaveLength(1);
    expect(bot.gateway.messages.size).toBe(0);
    const [row] = await bot.kit.db
      .select()
      .from(memberAchievements)
      .where(eq(memberAchievements.id, record.id));
    expect(row?.announcementMessageId).toBeNull();
    await bot.kit.db.execute(sql.raw('drop trigger test_fail_retract on jobs'));
    bot.kit.clock.advance(60_000);
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(1);
    expect(await jobStatuses(ANNOUNCE)).toEqual(['completed']);
  });

  it('retracts a revoked card and treats an already deleted message as done', async () => {
    await award();
    await bot.drain();
    const [messageId] = [...bot.gateway.messages.keys()];
    bot.gateway.failures.set(
      'deleteMessage',
      new DiscordActionError('delete message failed: Unknown Message', 10008, true),
    );
    await achievements.revokeAchievement(bot.kit.as(ops), {
      memberId: holder.memberId!,
      key: 'team_leader',
      reason: 'Awarded in error.',
    });
    await bot.drain();
    expect(bot.gateway.callsTo('deleteMessage')[0]?.args[1]).toBe(messageId);
    expect(await jobStatuses(RETRACT)).toEqual(['completed']);
  });

  it('BREAK: forged payloads dead-letter without touching Discord', async () => {
    const runAt = bot.kit.clock.now();
    await bot.kit.db.insert(jobs).values([
      { type: ANNOUNCE, runAt, payload: { memberAchievementId: 'nope', channelId: CHANNEL } },
      {
        type: RETRACT,
        runAt,
        payload: {
          memberAchievementId: '00000000-0000-4000-8000-000000000000',
          channelId: '@everyone',
          messageId: '1',
        },
      },
    ]);
    await bot.drain();
    expect(await jobStatuses(ANNOUNCE)).toEqual(['dead']);
    expect(await jobStatuses(RETRACT)).toEqual(['dead']);
    expect(bot.gateway.calls.filter((call) => call.method !== 'fetchMember')).toHaveLength(0);
  });
});
