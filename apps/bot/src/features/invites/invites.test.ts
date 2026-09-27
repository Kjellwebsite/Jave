import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  campaigns,
  inviteCodes,
  members,
  referralCodes,
  referrals,
} from '@jave/database';
import { DAY, invites, recordGuildJoin } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { createBotHarness, discordUser, type BotHarness } from '../../testing/harness';

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const ns = (action: string, ...args: (string | number)[]) => customId('invites', action, ...args);

type Status = 'joined' | 'retained' | 'valid' | 'left';

describe('invites feature: commands, components, modals', () => {
  let bot: BotHarness;
  let inviteeSequence = 0;

  beforeEach(async () => {
    bot = await createBotHarness();
  });
  afterEach(async () => {
    await bot.close();
  });

  /** A member who owns a mirrored Discord invite. */
  async function inviter(code: string) {
    const { actor, user } = await bot.member({ roles: ['verified'] });
    const current = await bot.kit.db.select().from(inviteCodes);
    await invites.syncInvites(bot.kit.system, [
      ...current.map((row) => ({ code: row.code, uses: row.uses })),
      { code, inviterDiscordId: actor.discordId, uses: 0 },
    ]);
    return { actor, user, code };
  }

  /** A join credited to `code`, then forced into a lifecycle state (fixture shortcut). */
  async function referral(code: string, status: Status, flags: string[] = []) {
    inviteeSequence += 1;
    bot.kit.clock.advance(3 * 60 * 60 * 1000);
    const username = `invitee${inviteeSequence}`;
    const joined = await recordGuildJoin(bot.kit.system, {
      discordId: `25000000000000${String(inviteeSequence).padStart(4, '0')}`,
      username,
      displayName: username,
    });
    const { referral: row } = await invites.attributeJoin(bot.kit.system, {
      inviteeUserId: joined.user.id,
      usedCode: code,
      joinedAt: bot.kit.clock.now(),
    });
    const now = bot.kit.clock.now().getTime();
    await bot.kit.db
      .update(referrals)
      .set({
        status,
        retainedAt: status === 'retained' || status === 'valid' ? new Date(now - DAY) : null,
        validatedAt: status === 'valid' ? new Date(now - DAY) : null,
        anomalyFlags: flags,
      })
      .where(eq(referrals.id, row.id));
    return { ...joined, discord: discordUser(joined.user.discordId, username) };
  }

  describe('/invites mine', () => {
    it('renders the funnel privately with next steps', async () => {
      const owner = await inviter('alpha01');
      await referral('alpha01', 'valid');
      await referral('alpha01', 'retained');
      await referral('alpha01', 'joined', ['fast_leave']);
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommand: 'mine',
        user: owner.user,
      });
      const payload = interaction.lastPayload()!;
      expect(payload.ephemeral).toBe(true);
      const text = interaction.lastText();
      expect(text).toContain('YOUR REFERRAL FUNNEL');
      expect(text).toMatch(/JOINED\s+3/);
      expect(text).toMatch(/RETAINED\s+2\s+67% of joined/);
      expect(text).toMatch(/VALID\s+1\s+33% of joined/);
      expect(text).toContain('UNDER REVIEW 1');
      expect(text).toContain('under review');
      // Inviters never see anomaly detail.
      expect(text).not.toContain('fast_leave');
      expect(text).not.toContain('FAST LEAVES');
      const buttons = payload.components!.flatMap((r) => r.components);
      expect(buttons.map((b) => ('custom_id' in b ? b.custom_id : ''))).toEqual([
        ns('codes'),
        ns('board', 'all'),
      ]);
    });
  });

  describe('/invites code', () => {
    it('creates and deactivates a personal code through buttons and a select', async () => {
      const { user, actor } = await bot.member();
      const view = await bot.run({ kind: 'slash', name: 'invites', subcommand: 'code', user });
      expect(view.interaction.lastText()).toContain('Personal codes: 0 of 3 active.');

      const created = await bot.run({ kind: 'button', name: ns('code-new'), user });
      expect(created.interaction.responses[0]?.type).toBe('update');
      expect(created.interaction.lastText()).toContain('CODE CREATED');
      const [code] = await bot.kit.db
        .select()
        .from(referralCodes)
        .where(eq(referralCodes.ownerUserId, actor.userId));
      expect(code?.active).toBe(true);
      expect(created.interaction.lastText()).toContain(code!.code);

      const off = await bot.run({
        kind: 'select',
        name: ns('code-off'),
        values: [code!.code],
        user,
      });
      expect(off.interaction.lastText()).toContain('CODE DEACTIVATED');
      const [after] = await bot.kit.db
        .select()
        .from(referralCodes)
        .where(eq(referralCodes.code, code!.code));
      expect(after?.active).toBe(false);
    });

    it('hides "new code" at the cap; a forged press is refused by core', async () => {
      const { user } = await bot.member();
      for (let i = 0; i < invites.MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER; i++) {
        await bot.run({ kind: 'button', name: ns('code-new'), user });
      }
      const view = await bot.run({ kind: 'slash', name: 'invites', subcommand: 'code', user });
      const ids = view.interaction
        .lastPayload()!
        .components!.flatMap((r) => r.components)
        .map((c) => ('custom_id' in c ? c.custom_id : ''));
      expect(ids).not.toContain(ns('code-new'));
      const forged = await bot.run({ kind: 'button', name: ns('code-new'), user });
      expect(forged.interaction.lastText()).toContain('CONFLICT');
    });

    it('BREAK: nobody deactivates another member’s code, and the attempt reveals nothing', async () => {
      const owner = await bot.member();
      await bot.run({ kind: 'button', name: ns('code-new'), user: owner.user });
      const [code] = await bot.kit.db.select().from(referralCodes);
      const attacker = await bot.member();
      const forged = await bot.run({
        kind: 'select',
        name: ns('code-off'),
        values: [code!.code],
        user: attacker.user,
      });
      expect(forged.interaction.lastText()).toContain('NOT FOUND');
      const [after] = await bot.kit.db.select().from(referralCodes);
      expect(after?.active).toBe(true);
      const audits = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'referral_code.deactivated'));
      expect(audits).toHaveLength(0);
    });

    it('a new member enters a referral code through the modal', async () => {
      const owner = await bot.member({ roles: ['verified'] });
      await bot.run({ kind: 'button', name: ns('code-new'), user: owner.user });
      const [code] = await bot.kit.db.select().from(referralCodes);
      const newcomer: InteractionUser = discordUser('260000000000000001', 'wren');
      await bot.app.events.memberJoin({
        ...newcomer,
        joinedAt: bot.kit.clock.now(),
      });
      const open = await bot.run({ kind: 'button', name: ns('claim'), user: newcomer });
      expect(open.interaction.responses[0]?.type).toBe('modal');
      const claimed = await bot.run({
        kind: 'modal',
        name: ns('claim'),
        user: newcomer,
        modalText: { code: code!.code.toLowerCase() },
      });
      expect(claimed.interaction.lastText()).toContain('REFERRAL RECORDED');
      // The promise matches the live rule (settings.analytics.validRequiresOnboarding).
      expect(claimed.interaction.lastText()).toContain('once you stay and complete onboarding');
      const [row] = await bot.kit.db
        .select()
        .from(referrals)
        .where(eq(referrals.referralCode, code!.code));
      expect(row).toMatchObject({ method: 'referral_code', inviterUserId: owner.actor.userId });
      const view = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommand: 'code',
        user: newcomer,
      });
      const ids = view.interaction
        .lastPayload()!
        .components!.flatMap((r) => r.components)
        .map((c) => ('custom_id' in c ? c.custom_id : ''));
      expect(ids).not.toContain(ns('claim'));
    });

    it('offers "enter a code" only inside the claim window', async () => {
      const { user } = await bot.member();
      const controls = async () => {
        const view = await bot.run({ kind: 'slash', name: 'invites', subcommand: 'code', user });
        return view.interaction
          .lastPayload()!
          .components!.flatMap((r) => r.components)
          .map((c) => ('custom_id' in c ? c.custom_id : ''));
      };
      expect(await controls()).toContain(ns('claim'));
      bot.kit.clock.advance((invites.REFERRAL_CLAIM_WINDOW_DAYS + 1) * DAY);
      expect(await controls()).not.toContain(ns('claim'));
    });

    it('BREAK: a member cannot credit their own code', async () => {
      const { user } = await bot.member();
      await bot.run({ kind: 'button', name: ns('code-new'), user });
      const [code] = await bot.kit.db.select().from(referralCodes);
      const self = await bot.run({
        kind: 'modal',
        name: ns('claim'),
        user,
        modalText: { code: code!.code },
      });
      expect(self.interaction.lastText()).toContain('INVALID INPUT');
      expect(self.interaction.lastText()).toContain('your own referral code');
    });
  });

  describe('/invites leaderboard', () => {
    it('lists VALID referrals only, respects opt-outs, and switches period in place', async () => {
      const first = await inviter('alpha01');
      const second = await inviter('beta02');
      const optedOut = await inviter('gamma03');
      await referral('alpha01', 'valid');
      await referral('alpha01', 'valid');
      await referral('alpha01', 'retained');
      await referral('beta02', 'valid');
      await referral('beta02', 'valid', ['join_burst']);
      await referral('gamma03', 'valid');
      await referral('gamma03', 'valid');
      await referral('gamma03', 'valid');
      await bot.kit.db
        .update(members)
        .set({ showOnLeaderboards: false })
        .where(eq(members.id, optedOut.actor.memberId!));
      const viewer = await bot.member();
      const board = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommand: 'leaderboard',
        user: viewer.user,
      });
      const text = board.interaction.lastText();
      expect(board.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(text).toContain(`${first.actor.displayName}** @`);
      expect(text).toMatch(/`01`.*2 valid/);
      expect(text).toMatch(/`02`.*1 valid/);
      expect(text).toContain(second.actor.displayName);
      expect(text).not.toContain(optedOut.actor.displayName);

      bot.kit.clock.advance(10 * DAY);
      const week = await bot.run({
        kind: 'select',
        name: ns('board-period'),
        values: ['7'],
        user: viewer.user,
      });
      expect(week.interaction.responses[0]?.type).toBe('update');
      expect(week.interaction.lastText()).toContain('LAST 7 DAYS');
      expect(week.interaction.lastText()).toContain('No VALID referrals in this period yet.');
    });

    it('shares a control-free public card on request', async () => {
      const viewer = await bot.member();
      const shared = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommand: 'leaderboard',
        options: { share: true, period: '30' },
        user: viewer.user,
      });
      const payload = shared.interaction.lastPayload()!;
      expect(payload.ephemeral).toBe(false);
      expect(payload.components).toBeUndefined();
      expect(shared.interaction.lastText()).toContain('LAST 30 DAYS');
    });

    it('BREAK: a forged period value is treated as an expired control', async () => {
      const viewer = await bot.member();
      const forged = await bot.run({
        kind: 'select',
        name: ns('board-period'),
        values: ['3650'],
        user: viewer.user,
      });
      expect(forged.interaction.lastText()).toContain('EXPIRED');
    });
  });

  describe('staff campaigns', () => {
    async function createCampaign(user: InteractionUser, key = 'autumn-drive') {
      return bot.run({
        kind: 'modal',
        name: ns('camp-create'),
        user,
        modalText: {
          key,
          name: 'Autumn drive',
          description: 'Recruitment for the <@&123456789012345678> autumn trials.',
          starts: '2026-02-01',
          ends: '2026-04-30',
        },
      });
    }

    it('core staff create a campaign from the modal; dates are UTC days, end inclusive', async () => {
      const staff = await bot.member({ roles: ['core'] });
      const open = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'create',
        user: staff.user,
      });
      expect(open.interaction.responses[0]?.type).toBe('modal');
      const created = await createCampaign(staff.user);
      expect(created.interaction.lastText()).toContain('CAMPAIGN CREATED — AUTUMN-DRIVE');
      expect(created.interaction.lastText()).toContain('ACCEPTING');
      // User text is neutralized.
      expect(created.interaction.lastText()).not.toContain('<@&123456789012345678>');
      const [row] = await bot.kit.db.select().from(campaigns);
      expect(row?.startsAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(row?.endsAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');

      const duplicate = await createCampaign(staff.user);
      expect(duplicate.interaction.lastText()).toContain('CONFLICT');
    });

    it('BREAK: malformed dates and keys are rejected before anything is written', async () => {
      const staff = await bot.member({ roles: ['core'] });
      const badDate = await bot.run({
        kind: 'modal',
        name: ns('camp-create'),
        user: staff.user,
        modalText: { key: 'spring', name: 'Spring', starts: '2026-02-30' },
      });
      expect(badDate.interaction.lastText()).toContain('INVALID INPUT');
      const badKey = await bot.run({
        kind: 'modal',
        name: ns('camp-create'),
        user: staff.user,
        modalText: { key: 'DROP TABLE;', name: 'Spring' },
      });
      expect(badKey.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(campaigns)).toHaveLength(0);
    });

    it('BREAK: members and operations cannot open the create modal; operations may list', async () => {
      const member = await bot.member();
      const denied = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'create',
        user: member.user,
      });
      expect(denied.interaction.responses.map((r) => r.type)).not.toContain('modal');
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const ops = await bot.member({ roles: ['operations'] });
      const opsCreate = await bot.run({ kind: 'button', name: ns('camp-new'), user: ops.user });
      expect(opsCreate.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedSubmit = await createCampaign(ops.user);
      expect(forgedSubmit.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const list = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'list',
        user: ops.user,
      });
      expect(list.interaction.lastText()).toContain('CAMPAIGNS');
      const ids = (list.interaction.lastPayload()!.components ?? [])
        .flatMap((r) => r.components)
        .map((c) => ('custom_id' in c ? c.custom_id : ''));
      expect(ids).not.toContain(ns('camp-new'));

      const memberList = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'list',
        user: member.user,
      });
      expect(memberList.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'access.denied'));
      expect(denials.length).toBeGreaterThanOrEqual(3);
    });

    it('lists, opens, attaches and detaches invites, and deactivates', async () => {
      const staff = await bot.member({ roles: ['core'] });
      await inviter('alpha01');
      await inviter('beta02');
      await createCampaign(staff.user);
      const [campaign] = await bot.kit.db.select().from(campaigns);
      const id = campaign!.id;

      const list = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'list',
        user: staff.user,
      });
      expect(list.interaction.lastText()).toContain('`autumn-drive`');
      const opened = await bot.run({
        kind: 'select',
        name: ns('camp-view'),
        values: [id],
        user: staff.user,
      });
      expect(opened.interaction.lastText()).toContain('CAMPAIGN · AUTUMN-DRIVE');

      const attach = await bot.run({
        kind: 'slash',
        name: 'invites',
        subcommandGroup: 'campaign',
        subcommand: 'attach',
        user: staff.user,
      });
      expect(attach.interaction.lastText()).toContain('Choose the campaign');
      const picker = await bot.run({
        kind: 'select',
        name: ns('camp-attach'),
        values: [id],
        user: staff.user,
      });
      expect(picker.interaction.lastText()).toContain('Live invites 1–2 of 2');
      const picked = await bot.run({
        kind: 'select',
        name: ns('inv-pick', id),
        values: ['beta02'],
        user: staff.user,
      });
      expect(picked.interaction.lastText()).toContain('INVITE ATTACHED — BETA02');
      const [beta] = await bot.kit.db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, 'beta02'));
      expect(beta?.campaignId).toBe(id);

      const detached = await bot.run({
        kind: 'select',
        name: ns('inv-detach', id),
        values: ['beta02'],
        user: staff.user,
      });
      expect(detached.interaction.lastText()).toContain('INVITE DETACHED — BETA02');
      const [betaAfter] = await bot.kit.db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, 'beta02'));
      expect(betaAfter?.campaignId).toBeNull();

      const off = await bot.run({
        kind: 'button',
        name: ns('camp-active', id, 0),
        user: staff.user,
      });
      expect(off.interaction.lastText()).toContain('CAMPAIGN DEACTIVATED');
      const again = await bot.run({
        kind: 'button',
        name: ns('camp-active', id, 0),
        user: staff.user,
      });
      expect(again.interaction.lastText()).toContain('INACTIVE');
      const [row] = await bot.kit.db.select().from(campaigns);
      expect(row?.active).toBe(false);
    });

    it('detaches an invite ranked past the first select page of a large campaign', async () => {
      const staff = await bot.member({ roles: ['core'] });
      await createCampaign(staff.user);
      const [campaign] = await bot.kit.db.select().from(campaigns);
      const attachedCount = 30;
      // Most used first: the least used invite ranks last, outside the first 25.
      await invites.syncInvites(
        bot.kit.system,
        Array.from({ length: attachedCount }, (_, index) => ({
          code: `bulk${String(index).padStart(2, '0')}`,
          uses: attachedCount - index,
        })),
      );
      await bot.kit.db.update(inviteCodes).set({ campaignId: campaign!.id });

      const detached = await bot.run({
        kind: 'select',
        name: ns('inv-detach', campaign!.id),
        values: ['bulk29'],
        user: staff.user,
      });
      expect(detached.interaction.lastText()).toContain('INVITE DETACHED — BULK29');
      const [row] = await bot.kit.db
        .select()
        .from(inviteCodes)
        .where(eq(inviteCodes.code, 'bulk29'));
      expect(row?.campaignId).toBeNull();
    });

    it('BREAK: forged, stale and malformed campaign controls change nothing', async () => {
      const staff = await bot.member({ roles: ['core'] });
      await inviter('alpha01');
      await createCampaign(staff.user);
      const [campaign] = await bot.kit.db.select().from(campaigns);
      const member = await bot.member();

      const forgedToggle = await bot.run({
        kind: 'button',
        name: ns('camp-active', campaign!.id, 0),
        user: member.user,
      });
      expect(forgedToggle.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedPick = await bot.run({
        kind: 'select',
        name: ns('inv-pick', campaign!.id),
        values: ['alpha01'],
        user: member.user,
      });
      expect(forgedPick.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedPage = await bot.run({
        kind: 'button',
        name: ns('inv-page', campaign!.id, 0),
        user: member.user,
      });
      expect(forgedPage.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const malformed = await bot.run({
        kind: 'button',
        name: ns('camp-active', 'not-a-uuid', 0),
        user: staff.user,
      });
      expect(malformed.interaction.lastText()).toContain('INVALID INPUT');
      const badFlag = await bot.run({
        kind: 'button',
        name: ns('camp-active', campaign!.id, 7),
        user: staff.user,
      });
      expect(badFlag.interaction.lastText()).toContain('INVALID INPUT');
      const badOffset = await bot.run({
        kind: 'button',
        name: ns('inv-page', campaign!.id, -25),
        user: staff.user,
      });
      expect(badOffset.interaction.lastText()).toContain('INVALID INPUT');
      const notAttached = await bot.run({
        kind: 'select',
        name: ns('inv-detach', campaign!.id),
        values: ['alpha01'],
        user: staff.user,
      });
      expect(notAttached.interaction.lastText()).toContain('NOT FOUND');
      const unknownCampaign = await bot.run({
        kind: 'select',
        name: ns('camp-view'),
        values: ['00000000-0000-4000-8000-000000000000'],
        user: staff.user,
      });
      expect(unknownCampaign.interaction.lastText()).toContain('NOT FOUND');
      const unknownAction = await bot.run({
        kind: 'button',
        name: ns('self-destruct'),
        user: staff.user,
      });
      expect(unknownAction.interaction.lastText()).toContain('EXPIRED');

      const [row] = await bot.kit.db.select().from(campaigns);
      expect(row?.active).toBe(true);
      const attached = await bot.kit.db
        .select()
        .from(inviteCodes)
        .where(and(eq(inviteCodes.code, 'alpha01'), eq(inviteCodes.campaignId, campaign!.id)));
      expect(attached).toHaveLength(0);
    });
  });

  describe('Referral Funnel context menu', () => {
    it('shows your own funnel without anomaly detail', async () => {
      const owner = await inviter('alpha01');
      await referral('alpha01', 'left', ['fast_leave']);
      const own = await bot.run({
        kind: 'user_context',
        name: 'Referral Funnel',
        user: owner.user,
        targetUser: owner.user,
      });
      expect(own.interaction.lastText()).toContain('REFERRAL FUNNEL');
      expect(own.interaction.lastText()).toContain('LEFT 1');
      expect(own.interaction.lastText()).not.toContain('FAST LEAVES');
    });

    it('analytics staff see anyone’s funnel with fast leaves; members see only their own', async () => {
      const owner = await inviter('alpha01');
      await referral('alpha01', 'left', ['fast_leave']);
      const ops = await bot.member({ roles: ['operations'] });
      const staffView = await bot.run({
        kind: 'user_context',
        name: 'Referral Funnel',
        user: ops.user,
        targetUser: owner.user,
      });
      expect(staffView.interaction.lastText()).toContain('FAST LEAVES 1');
      const member = await bot.member();
      const denied = await bot.run({
        kind: 'user_context',
        name: 'Referral Funnel',
        user: member.user,
        targetUser: owner.user,
      });
      expect(denied.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(denied.interaction.lastPayload()!.ephemeral).toBe(true);
    });

    it('BREAK: the menu never reveals whether a user has a JVLN profile', async () => {
      const stranger = discordUser('270000000000000001', 'stranger');
      const member = await bot.member();
      const probe = await bot.run({
        kind: 'user_context',
        name: 'Referral Funnel',
        user: member.user,
        targetUser: stranger,
      });
      // Same answer as for someone who has a profile: the lookup never runs.
      expect(probe.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(probe.interaction.lastText()).not.toContain('NOT FOUND');
      const ops = await bot.member({ roles: ['operations'] });
      const staff = await bot.run({
        kind: 'user_context',
        name: 'Referral Funnel',
        user: ops.user,
        targetUser: stranger,
      });
      expect(staff.interaction.lastText()).toContain('NOT FOUND');
    });
  });
});
