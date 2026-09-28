import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, campaigns, inviteCodes } from '@jave/database';
import { invites } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser, ReplyPayload } from '../../interactions/types';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { LIMITS } from '../../ui/theme';
import { fitLines } from './campaigns';

vi.setConfig({ hookTimeout: 180_000, testTimeout: 60_000 });

const ns = (action: string, ...args: (string | number)[]) => customId('invites', action, ...args);

function componentIds(payload: ReplyPayload): string[] {
  return (payload.components ?? [])
    .flatMap((r) => r.components)
    .map((c) => ('custom_id' in c ? c.custom_id : ''));
}

function selectValues(payload: ReplyPayload, id: string): string[] {
  const select = (payload.components ?? [])
    .flatMap((r) => r.components)
    .find((c) => 'custom_id' in c && c.custom_id === id);
  return select && 'options' in select ? select.options.map((o) => o.value) : [];
}

describe('fitLines', () => {
  it('keeps whole lines within the field limit and counts the rest', () => {
    const lines = Array.from(
      { length: 40 },
      (_, index) => `\`code${index}\` · ${index} uses · deleted`,
    );
    const value = fitLines(lines);
    expect(value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
    const shown = value.split('\n');
    const summary = shown.pop();
    expect(summary).toBe(`+ ${lines.length - shown.length} more`);
    expect(shown).toEqual(lines.slice(0, shown.length));
    // Never a cut code span.
    for (const line of shown) expect(line.split('`')).toHaveLength(3);
  });

  it('returns short lists unchanged', () => {
    expect(fitLines(['a', 'b'])).toBe('a\nb');
  });
});

describe('invites feature: staff campaigns', () => {
  let bot: BotHarness;

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

  it('pages attached invites and detaches one ranked past the first page', async () => {
    const staff = await bot.member({ roles: ['core'] });
    await createCampaign(staff.user);
    const [campaign] = await bot.kit.db.select().from(campaigns);
    const id = campaign!.id;
    const attachedCount = 30;
    // Most used first: the least used invite ranks last, outside the first 25.
    await invites.syncInvites(
      bot.kit.system,
      Array.from({ length: attachedCount }, (_, index) => ({
        code: `bulk${String(index).padStart(2, '0')}`,
        uses: attachedCount - index,
      })),
    );
    await bot.kit.db.update(inviteCodes).set({ campaignId: id });

    const first = await bot.run({
      kind: 'select',
      name: ns('camp-view'),
      values: [id],
      user: staff.user,
    });
    expect(first.interaction.lastText()).toContain('ATTACHED INVITES · 1–25 OF 30');
    const firstIds = componentIds(first.interaction.lastPayload()!);
    expect(firstIds).toContain(ns('camp-view-id', id, 25));
    expect(firstIds).not.toContain(ns('camp-view-id', id, 0));
    expect(selectValues(first.interaction.lastPayload()!, ns('inv-detach', id, 0))).not.toContain(
      'bulk29',
    );

    const second = await bot.run({
      kind: 'button',
      name: ns('camp-view-id', id, 25),
      user: staff.user,
    });
    expect(second.interaction.lastText()).toContain('ATTACHED INVITES · 26–30 OF 30');
    const secondPayload = second.interaction.lastPayload()!;
    expect(componentIds(secondPayload)).toContain(ns('camp-view-id', id, 0));
    expect(selectValues(secondPayload, ns('inv-detach', id, 25))).toContain('bulk29');

    const detached = await bot.run({
      kind: 'select',
      name: ns('inv-detach', id, 25),
      values: ['bulk29'],
      user: staff.user,
    });
    expect(detached.interaction.lastText()).toContain('INVITE DETACHED — BULK29');
    // The card stays on the page it was on.
    expect(detached.interaction.lastText()).toContain('ATTACHED INVITES · 26–29 OF 29');
    const [row] = await bot.kit.db.select().from(inviteCodes).where(eq(inviteCodes.code, 'bulk29'));
    expect(row?.campaignId).toBeNull();
  });

  it('shows invites Discord deleted as attached, and detaches them', async () => {
    const staff = await bot.member({ roles: ['core'] });
    await inviter('alpha01');
    await inviter('event02');
    await createCampaign(staff.user);
    const [campaign] = await bot.kit.db.select().from(campaigns);
    const id = campaign!.id;
    await invites.attachInviteToCampaign(bot.kit.system, { code: 'alpha01', campaignId: id });
    await invites.attachInviteToCampaign(bot.kit.system, { code: 'event02', campaignId: id });
    // The event invite expires: the mirror marks it deleted, the attachment stays.
    await invites.syncInvites(bot.kit.system, [{ code: 'alpha01', uses: 0 }]);

    const card = await bot.run({ kind: 'button', name: ns('camp-view-id', id), user: staff.user });
    expect(card.interaction.lastText()).toContain('`event02` · 0 uses · deleted');
    expect(selectValues(card.interaction.lastPayload()!, ns('inv-detach', id, 0))).toEqual([
      'alpha01',
      'event02',
    ]);
    const detached = await bot.run({
      kind: 'select',
      name: ns('inv-detach', id, 0),
      values: ['event02'],
      user: staff.user,
    });
    expect(detached.interaction.lastText()).toContain('INVITE DETACHED — EVENT02');
    const [row] = await bot.kit.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, 'event02'));
    expect(row?.campaignId).toBeNull();
  });

  it('a stale page past the end shows the last page instead', async () => {
    const staff = await bot.member({ roles: ['core'] });
    await inviter('alpha01');
    await createCampaign(staff.user);
    const [campaign] = await bot.kit.db.select().from(campaigns);
    await invites.attachInviteToCampaign(bot.kit.system, {
      code: 'alpha01',
      campaignId: campaign!.id,
    });
    const stale = await bot.run({
      kind: 'button',
      name: ns('camp-view-id', campaign!.id, 50),
      user: staff.user,
    });
    expect(stale.interaction.lastText()).toContain('`alpha01`');
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
      name: ns('inv-detach', campaign!.id, 0),
      values: ['alpha01'],
      user: staff.user,
    });
    expect(notAttached.interaction.lastText()).toContain('NOT FOUND');
    const badDetachOffset = await bot.run({
      kind: 'select',
      name: ns('inv-detach', campaign!.id, 'x'),
      values: ['alpha01'],
      user: staff.user,
    });
    expect(badDetachOffset.interaction.lastText()).toContain('INVALID INPUT');
    const badCardOffset = await bot.run({
      kind: 'button',
      name: ns('camp-view-id', campaign!.id, -1),
      user: staff.user,
    });
    expect(badCardOffset.interaction.lastText()).toContain('INVALID INPUT');
    const forgedDetach = await bot.run({
      kind: 'select',
      name: ns('inv-detach', campaign!.id, 0),
      values: ['alpha01'],
      user: member.user,
    });
    expect(forgedDetach.interaction.lastText()).toContain('ACCESS RESTRICTED');
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
