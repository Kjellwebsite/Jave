import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { jobs, members } from '@jave/database';
import {
  DISCORD_ROLE_SYNC_JOB,
  grantRoleUnchecked,
  moderation,
  revokeRoleUnchecked,
  updateSettings,
  type UserActor,
} from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';

const MEMBER_ROLE = '500000000000000001';
const VERIFIED_ROLE = '500000000000000002';
const SUPPORTER_ROLE = '500000000000000003';
const QUARANTINE_ROLE = '500000000000000009';
const UNRELATED_ROLE = '500000000000000077';

describe('role sync: quarantine', () => {
  let bot: BotHarness;
  let moderator: UserActor;
  let target: { actor: UserActor };

  beforeEach(async () => {
    bot = await createBotHarness();
    const founder = await bot.member({ roles: ['founder'] });
    await updateSettings(bot.kit.as(founder.actor), 'roles', {
      discordRoleIds: { member: MEMBER_ROLE, verified: VERIFIED_ROLE, supporter: SUPPORTER_ROLE },
      quarantineRoleId: QUARANTINE_ROLE,
    });
    moderator = (await bot.member({ roles: ['moderator'] })).actor;
    target = await bot.member({ roles: ['verified', 'supporter'] });
    await bot.drain();
    bot.gateway.members.get(target.actor.discordId)!.roleIds.push(UNRELATED_ROLE);
  });
  afterEach(async () => {
    await bot.close();
  });

  const discordRoles = () => [...bot.gateway.members.get(target.actor.discordId)!.roleIds].sort();

  it('strips managed roles while quarantined and restores them on release', async () => {
    expect(discordRoles()).toEqual([SUPPORTER_ROLE, VERIFIED_ROLE, UNRELATED_ROLE].sort());

    await moderation.quarantineMember(bot.kit.as(moderator), {
      targetUserId: target.actor.userId,
      reason: 'Suspicious link burst',
    });
    // A role change during quarantine must not hand managed roles back.
    await revokeRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'supporter',
      reason: 'lapsed while quarantined',
    });
    await bot.drain();
    // Moderation applies the quarantine role; role sync strips every managed role.
    expect(discordRoles()).toEqual([QUARANTINE_ROLE, UNRELATED_ROLE].sort());

    await moderation.releaseMember(bot.kit.as(moderator), {
      targetUserId: target.actor.userId,
      reason: 'Reviewed: false positive',
    });
    await bot.drain();
    expect(discordRoles()).toEqual([VERIFIED_ROLE, UNRELATED_ROLE].sort());
  });

  it('never touches the quarantine role or unrelated roles', async () => {
    await bot.kit.db
      .update(members)
      .set({ standing: 'quarantined' })
      .where(eq(members.id, target.actor.memberId!));
    bot.gateway.members.get(target.actor.discordId)!.roleIds.push(QUARANTINE_ROLE);
    await grantRoleUnchecked(bot.kit.system, {
      memberId: target.actor.memberId!,
      role: 'core',
      reason: 'trigger a sync',
    });
    await bot.drain();
    expect(discordRoles()).toEqual([QUARANTINE_ROLE, UNRELATED_ROLE].sort());
  });

  it('strips managed roles from deleted members', async () => {
    await bot.kit.db
      .update(members)
      .set({ deletedAt: bot.kit.clock.now() })
      .where(eq(members.id, target.actor.memberId!));
    await bot.kit.db.insert(jobs).values({
      type: DISCORD_ROLE_SYNC_JOB,
      payload: { memberId: target.actor.memberId! },
      runAt: bot.kit.clock.now(),
    });
    await bot.drain();
    expect(discordRoles()).toEqual([UNRELATED_ROLE]);
  });
});
