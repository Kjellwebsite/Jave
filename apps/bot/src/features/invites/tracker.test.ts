import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { guildMemberEvents, inviteCodes, referrals, users } from '@jave/database';
import { invites } from '@jave/core';
import { DiscordActionError, type InviteSnapshot } from '../../discord/gateway';
import type { JoinedMember } from '../../gateway-events/types';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { CONSUMED_INVITE_GRACE_MS, toSyncInput, trackerFor } from './tracker';

/** PGlite boots (WASM compile) slowly on a loaded machine; allow for it. */
vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const INVITER_ID = '220000000000000001';
const OTHER_INVITER_ID = '220000000000000002';
const MISSING_ACCESS = 50001;

function invite(code: string, uses: number, extra: Partial<InviteSnapshot> = {}): InviteSnapshot {
  return {
    code,
    inviterDiscordId: INVITER_ID,
    channelId: '230000000000000001',
    uses,
    maxUses: null,
    temporary: false,
    createdAt: null,
    expiresAt: null,
    vanity: false,
    inviterUsername: 'vela',
    ...extra,
  };
}

const vanity = (uses: number) =>
  invite('javelin', uses, { vanity: true, inviterDiscordId: null, inviterUsername: null });

describe('invites: tracker (gateway listeners)', () => {
  let bot: BotHarness;
  let sequence = 0;

  beforeEach(async () => {
    bot = await createBotHarness();
  });
  afterEach(async () => {
    await bot.close();
  });

  function joiner(username: string): JoinedMember {
    sequence += 1;
    return {
      id: `24000000000000${String(sequence).padStart(4, '0')}`,
      username,
      globalName: username,
      avatar: null,
      bot: false,
      joinedAt: bot.kit.clock.now(),
    };
  }

  /** Members join through Discord: the invite's use count rises, then the event arrives. */
  async function join(username: string, use?: string): Promise<JoinedMember> {
    const member = joiner(username);
    if (use) bumpUse(use);
    await bot.app.events.memberJoin(member);
    return member;
  }

  function bumpUse(code: string) {
    const target = bot.gateway.invites.find((candidate) => candidate.code === code);
    if (!target) throw new Error(`no invite ${code}`);
    target.uses += 1;
  }

  async function referralOf(member: JoinedMember) {
    const [row] = await bot.kit.db
      .select({ referral: referrals, inviterDiscordId: users.discordId })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.inviteeUserId))
      .where(eq(users.discordId, member.id));
    if (!row) return null;
    const [inviter] = row.referral.inviterUserId
      ? await bot.kit.db.select().from(users).where(eq(users.id, row.referral.inviterUserId))
      : [];
    return { ...row.referral, inviterDiscordId: inviter?.discordId ?? null };
  }

  async function mirror() {
    return bot.kit.db.select().from(inviteCodes).orderBy(inviteCodes.code);
  }

  it('mirrors every invite on ready, vanity flagged, inviters created with their name', async () => {
    bot.gateway.invites = [invite('alpha01', 3), vanity(10)];
    await bot.app.events.ready();
    const rows = await mirror();
    expect(rows.map((r) => [r.code, r.uses, r.isVanity])).toEqual([
      ['alpha01', 3, false],
      ['javelin', 10, true],
    ]);
    const [inviter] = await bot.kit.db.select().from(users).where(eq(users.discordId, INVITER_ID));
    expect(inviter?.username).toBe('vela');
  });

  it('attributes a join to the invite whose use count rose, crediting its inviter', async () => {
    bot.gateway.invites = [invite('alpha01', 3), invite('beta02', 0)];
    await bot.app.events.ready();
    const member = await join('nova', 'beta02');
    const row = await referralOf(member);
    expect(row).toMatchObject({
      method: 'invite',
      inviteCode: 'beta02',
      status: 'joined',
      inviterDiscordId: INVITER_ID,
    });
    // The core feature recorded the join itself, exactly once.
    const joins = await bot.kit.db
      .select()
      .from(guildMemberEvents)
      .where(eq(guildMemberEvents.type, 'join'));
    expect(joins).toHaveLength(1);
    expect((await mirror()).find((r) => r.code === 'beta02')?.uses).toBe(1);
  });

  it('attributes vanity-URL joins as method vanity with no inviter', async () => {
    bot.gateway.invites = [invite('alpha01', 3), vanity(10)];
    await bot.app.events.ready();
    const member = await join('orion', 'javelin');
    expect(await referralOf(member)).toMatchObject({
      method: 'vanity',
      inviteCode: 'javelin',
      inviterUserId: null,
    });
  });

  it('credits an invite created moments ago, before its create event was processed', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await bot.app.events.ready();
    bot.gateway.invites.push(invite('fresh03', 0, { inviterDiscordId: OTHER_INVITER_ID }));
    const member = await join('lyra', 'fresh03');
    expect(await referralOf(member)).toMatchObject({
      method: 'invite',
      inviteCode: 'fresh03',
      inviterDiscordId: OTHER_INVITER_ID,
    });
  });

  it('credits a single-use invite that Discord deleted on the use that brought the member', async () => {
    bot.gateway.invites = [invite('once04', 0, { maxUses: 1 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    bot.gateway.invites = bot.gateway.invites.filter((i) => i.code !== 'once04');
    const member = await join('vega');
    expect(await referralOf(member)).toMatchObject({ method: 'invite', inviteCode: 'once04' });
    expect((await mirror()).find((r) => r.code === 'once04')?.deletedAt).not.toBeNull();
  });

  /** Discord consumes the last use and deletes the invite; its delete event may come first. */
  function consumeLastUse(code: string) {
    bot.gateway.invites = bot.gateway.invites.filter((candidate) => candidate.code !== code);
  }

  it('credits a single-use invite whose delete event arrives before the member add', async () => {
    bot.gateway.invites = [invite('once04', 0, { maxUses: 1 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    consumeLastUse('once04');
    await bot.app.events.invitesChanged();
    const member = await join('vega');
    expect(await referralOf(member)).toMatchObject({
      method: 'invite',
      inviteCode: 'once04',
      inviterDiscordId: INVITER_ID,
    });
  });

  it('keeps a consumed invite through an unrelated invite event before the member add', async () => {
    bot.gateway.invites = [invite('once04', 2, { maxUses: 3 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    consumeLastUse('once04');
    await bot.app.events.invitesChanged();
    bot.gateway.invites.push(invite('fresh05', 0, { inviterDiscordId: OTHER_INVITER_ID }));
    await bot.app.events.invitesChanged();
    const member = await join('altais');
    expect(await referralOf(member)).toMatchObject({ method: 'invite', inviteCode: 'once04' });
  });

  it('gives a consumed-invite tombstone exactly one join', async () => {
    bot.gateway.invites = [invite('once04', 0, { maxUses: 1 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    consumeLastUse('once04');
    await bot.app.events.invitesChanged();
    const credited = await join('vega');
    const next = await join('lyra', 'alpha01');
    expect(await referralOf(credited)).toMatchObject({ inviteCode: 'once04' });
    expect(await referralOf(next)).toMatchObject({ method: 'invite', inviteCode: 'alpha01' });
  });

  it('BREAK: a deleted invite with one use left never collects credit after the grace', async () => {
    bot.gateway.invites = [invite('once04', 0, { maxUses: 1 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    // Staff delete the invite; no join follows it.
    consumeLastUse('once04');
    await bot.app.events.invitesChanged();
    bot.kit.clock.advance(CONSUMED_INVITE_GRACE_MS + 1);
    const member = await join('rigel');
    expect(await referralOf(member)).toMatchObject({ method: 'unknown', inviteCode: null });
  });

  it('BREAK: a tombstone never turns a concurrent join into a false credit', async () => {
    bot.gateway.invites = [invite('once04', 0, { maxUses: 1 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    consumeLastUse('once04');
    await bot.app.events.invitesChanged();
    // Another member's use lands first: two candidates, so unknown; the tombstone is spent.
    const other = await join('sirius', 'alpha01');
    const member = await join('vega');
    expect(await referralOf(other)).toMatchObject({ method: 'unknown', inviteCode: null });
    expect(await referralOf(member)).toMatchObject({ method: 'unknown', inviteCode: null });
  });

  it('BREAK: an invite deleted with uses left is not a tombstone', async () => {
    bot.gateway.invites = [invite('multi06', 1, { maxUses: 5 }), invite('alpha01', 3)];
    await bot.app.events.ready();
    consumeLastUse('multi06');
    await bot.app.events.invitesChanged();
    const member = await join('deneb');
    expect(await referralOf(member)).toMatchObject({ method: 'unknown', inviteCode: null });
  });

  it('records unknown rather than guessing when two invites changed', async () => {
    bot.gateway.invites = [invite('alpha01', 3), invite('beta02', 0)];
    await bot.app.events.ready();
    bumpUse('alpha01');
    const member = await join('rigel', 'beta02');
    expect(await referralOf(member)).toMatchObject({
      method: 'unknown',
      inviteCode: null,
      inviterUserId: null,
    });
  });

  it('uses the mirror as the baseline when the cache is cold (restart before ready)', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await invites.syncInvites(bot.kit.system, bot.gateway.invites.map(toSyncInput));
    const member = await join('deneb', 'alpha01');
    expect(await referralOf(member)).toMatchObject({ method: 'invite', inviteCode: 'alpha01' });
  });

  it('serializes concurrent joins so each diff starts where the previous one ended', async () => {
    bot.gateway.invites = [invite('alpha01', 3), invite('beta02', 0)];
    await bot.app.events.ready();
    const fetchesBefore = bot.gateway.callsTo('listInvites').length;
    const first = joiner('altair');
    const second = joiner('sirius');
    bumpUse('alpha01');
    const firstJoin = bot.app.events.memberJoin(first);
    // The second member joins after the first join's fetch has already happened.
    await vi.waitFor(() =>
      expect(bot.gateway.callsTo('listInvites').length).toBe(fetchesBefore + 1),
    );
    bumpUse('beta02');
    const secondJoin = bot.app.events.memberJoin(second);
    await Promise.all([firstJoin, secondJoin]);
    expect(await referralOf(first)).toMatchObject({ method: 'invite', inviteCode: 'alpha01' });
    expect(await referralOf(second)).toMatchObject({ method: 'invite', inviteCode: 'beta02' });
  });

  it('attributes a repeated gateway event for the same join only once', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await bot.app.events.ready();
    const member = joiner('spica');
    bumpUse('alpha01');
    const tracker = trackerFor(bot.app.services);
    const firstRun = await tracker.attributeJoin(member);
    const replay = await tracker.attributeJoin(member);
    expect(firstRun.created).toBe(true);
    expect(replay).toMatchObject({ created: false, referralId: firstRun.referralId });
    expect(await bot.kit.db.select().from(referrals)).toHaveLength(1);
  });

  it('ignores bot accounts', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await bot.app.events.ready();
    const fetches = bot.gateway.callsTo('listInvites').length;
    await bot.app.events.memberJoin({ ...joiner('helper-bot'), bot: true });
    expect(bot.gateway.callsTo('listInvites')).toHaveLength(fetches);
    expect(await bot.kit.db.select().from(referrals)).toHaveLength(0);
  });

  it('coalesces bursts of invite events into at most one queued fetch', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    const tracker = trackerFor(bot.app.services);
    const results = await Promise.all(Array.from({ length: 6 }, () => tracker.resync('changed')));
    expect(bot.gateway.callsTo('listInvites')).toHaveLength(1);
    expect(results.every((r) => r.synced)).toBe(true);
    await bot.app.events.invitesChanged();
    expect(bot.gateway.callsTo('listInvites')).toHaveLength(2);
  });

  it('BREAK: a failed fetch on ready never wipes the mirror', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await bot.app.events.ready();
    bot.gateway.failures.set(
      'listInvites',
      new DiscordActionError('list invites failed: Missing Access', MISSING_ACCESS, true),
    );
    const outcome = await trackerFor(bot.app.services).resync('ready');
    expect(outcome).toEqual({ synced: false, reason: 'fetch_failed' });
    expect((await mirror()).map((r) => [r.code, r.deletedAt])).toEqual([['alpha01', null]]);
  });

  it('BREAK: without Manage Guild, joins are still recorded, as unknown', async () => {
    bot.gateway.invites = [invite('alpha01', 3)];
    await bot.app.events.ready();
    bot.gateway.failures.set(
      'listInvites',
      new DiscordActionError('list invites failed: Missing Permissions', MISSING_ACCESS, true),
    );
    const member = joiner('mira');
    bumpUse('alpha01');
    const outcome = await trackerFor(bot.app.services).attributeJoin(member);
    expect(outcome).toMatchObject({ method: 'unknown', reason: 'fetch_failed', created: true });
    expect(await referralOf(member)).toMatchObject({ method: 'unknown', inviteCode: null });
    expect((await mirror()).map((r) => r.deletedAt)).toEqual([null]);
  });

  it('BREAK: a missed use (event lost while offline) never shifts credit to the next join', async () => {
    bot.gateway.invites = [invite('alpha01', 3), invite('beta02', 0)];
    await bot.app.events.ready();
    bumpUse('alpha01'); // someone joined while the gateway was disconnected
    bumpUse('alpha01');
    const member = await join('castor');
    expect(await referralOf(member)).toMatchObject({ method: 'unknown', inviteCode: null });
  });
});
