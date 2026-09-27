import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, contributions, evidence } from '@jave/database';
import { projects, type UserActor } from '@jave/core';
import { ComponentType } from 'discord.js';
import { createBotHarness, TEST_GUILD_ID, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { CONTRIBUTION_TITLE_MAX } from './constants';
import { titleFromMessage } from './context-menu';
import { customIds } from './testing';

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

describe('contributions', () => {
  let bot: BotHarness;
  let owner: Person;
  let author: Person;
  let projectId: string;

  beforeEach(async () => {
    bot = await createBotHarness();
    owner = await bot.member({ roles: ['verified'], username: 'mara' });
    author = await bot.member({ roles: ['verified'], username: 'jun' });
    const project = await projects.createProject(bot.kit.as(owner.actor), {
      title: 'Rocket Engine',
    });
    projectId = project.id;
    await projects.addProjectMember(bot.kit.as(owner.actor), {
      projectId,
      memberId: author.actor.memberId!,
    });
  });
  afterEach(async () => {
    await bot.close();
  });

  const record = (who: Person, title: string, onProject = true) =>
    projects.recordContribution(bot.kit.as(who.actor), {
      projectId: onProject ? projectId : undefined,
      kind: 'code',
      title,
    });

  it('/contribute add autocompletes your projects, opens the modal and records', async () => {
    const auto = await bot.run({
      kind: 'autocomplete',
      name: 'contribute',
      subcommand: 'add',
      user: author.user,
      focused: { name: 'project', value: 'rocket' },
    });
    expect(auto.interaction.responses[0]).toMatchObject({
      choices: [{ name: 'Rocket Engine · IDEA', value: projectId }],
    });
    const opened = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'add',
      user: author.user,
      options: { project: projectId },
    });
    expect(opened.interaction.responses[0]?.type).toBe('modal');
    const submitted = await bot.run({
      kind: 'modal',
      name: customId('projects', 'contribute', projectId),
      user: author.user,
      modalText: {
        title: 'Injector redesign',
        url: 'https://github.com/javelin/engine/pull/7',
        description: 'Halved pressure drop',
      },
      modalSelect: { kind: ['design'] },
    });
    expect(submitted.interaction.lastText()).toContain('CONTRIBUTION RECORDED');
    const [row] = await bot.kit.db.select().from(contributions);
    expect(row).toMatchObject({
      memberId: author.actor.memberId,
      projectId,
      kind: 'design',
      status: 'submitted',
      url: 'https://github.com/javelin/engine/pull/7',
    });
  });

  it('records contributions without a project from the card-less modal', async () => {
    const submitted = await bot.run({
      kind: 'modal',
      name: customId('projects', 'contribute', 'none'),
      user: author.user,
      modalText: { title: 'Mentored two trial teams' },
      modalSelect: { kind: ['mentoring'] },
    });
    expect(submitted.interaction.lastText()).toContain('CONTRIBUTION RECORDED');
    const [row] = await bot.kit.db.select().from(contributions);
    expect(row!.projectId).toBeNull();
  });

  it('BREAK: outsiders cannot attach contributions to a project; bad links and kinds are refused', async () => {
    const outsider = await bot.member({ roles: ['verified'] });
    const card = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'add',
      user: outsider.user,
      options: { project: projectId },
    });
    expect(card.interaction.lastText()).toContain('NOT ON THIS PROJECT');
    const forged = await bot.run({
      kind: 'modal',
      name: customId('projects', 'contribute', projectId),
      user: outsider.user,
      modalText: { title: 'Claiming credit' },
      modalSelect: { kind: ['code'] },
    });
    expect(forged.interaction.lastText()).toContain('NOT FOUND');
    const badUrl = await bot.run({
      kind: 'modal',
      name: customId('projects', 'contribute', 'none'),
      user: author.user,
      modalText: { title: 'Script', url: 'javascript:alert(1)' },
      modalSelect: { kind: ['code'] },
    });
    expect(badUrl.interaction.lastText()).toContain('INVALID INPUT');
    const badKind = await bot.run({
      kind: 'modal',
      name: customId('projects', 'contribute', 'none'),
      user: author.user,
      modalText: { title: 'Script' },
      modalSelect: { kind: ['xp'] },
    });
    expect(badKind.interaction.lastText()).toContain('INVALID INPUT');
    expect(await bot.kit.db.select().from(contributions)).toHaveLength(0);
  });

  it('project owners review from the queue: verify becomes accepted evidence', async () => {
    const mine = await record(owner, 'Own work');
    const theirs = await record(author, 'Injector redesign');
    const queue = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'review',
      user: owner.user,
    });
    const text = queue.interaction.lastText();
    expect(text).toContain('CONTRIBUTION REVIEW · 1/1');
    expect(text).toContain('Injector redesign');
    expect(text).not.toContain('Own work');
    expect(customIds(queue.interaction.lastPayload())).toEqual([
      customId('projects', 'cverify', theirs.id, 0),
      customId('projects', 'creject', theirs.id, 0),
      customId('projects', 'cq', 1),
    ]);
    const verified = await bot.run({
      kind: 'button',
      name: customId('projects', 'cverify', theirs.id, 0),
      user: owner.user,
    });
    expect(verified.interaction.lastText()).toContain('CONTRIBUTION VERIFIED');
    const [row] = await bot.kit.db
      .select()
      .from(contributions)
      .where(eq(contributions.id, theirs.id));
    expect(row!.status).toBe('verified');
    const accepted = await bot.kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.sourceId, theirs.id));
    expect(accepted[0]!.status).toBe('accepted');
    const next = await bot.run({
      kind: 'button',
      name: customId('projects', 'cq', 0),
      user: owner.user,
    });
    expect(next.interaction.lastText()).toContain('QUEUE CLEAR');
    expect(mine.status).toBe('submitted');
    await bot.drain();
  });

  it('reject asks for a reason the author can read', async () => {
    const theirs = await record(author, 'Half-finished parser');
    const modal = await bot.run({
      kind: 'button',
      name: customId('projects', 'creject', theirs.id, 0),
      user: owner.user,
    });
    expect(modal.interaction.responses[0]?.type).toBe('modal');
    const tooShort = await bot.run({
      kind: 'modal',
      name: customId('projects', 'creject', theirs.id, 0),
      user: owner.user,
      modalText: { reason: 'no' },
    });
    expect(tooShort.interaction.lastText()).toContain('INVALID INPUT');
    const rejected = await bot.run({
      kind: 'modal',
      name: customId('projects', 'creject', theirs.id, 0),
      user: owner.user,
      modalText: { reason: 'The PR was reverted the next day.' },
    });
    expect(rejected.interaction.lastText()).toContain('CONTRIBUTION REJECTED');
    const list = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'list',
      user: author.user,
    });
    expect(list.interaction.lastText()).toContain('REJECTED');
    expect(list.interaction.lastText()).toContain('The PR was reverted the next day.');
  });

  it('BREAK: nobody verifies their own work, even with a forged button', async () => {
    const staff = await bot.member({ roles: ['core'] });
    const own = await projects.recordContribution(bot.kit.as(staff.actor), {
      kind: 'code',
      title: 'Self-promotion',
    });
    const queue = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'review',
      user: staff.user,
    });
    expect(queue.interaction.lastText()).toContain('QUEUE CLEAR');
    const forged = await bot.run({
      kind: 'button',
      name: customId('projects', 'cverify', own.id, 0),
      user: staff.user,
    });
    expect(forged.interaction.lastText()).toContain('cannot review your own');
    const [row] = await bot.kit.db.select().from(contributions).where(eq(contributions.id, own.id));
    expect(row!.status).toBe('submitted');
    const blocked = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'contribution.self_review_blocked'),
          eq(auditLogs.targetId, own.id),
        ),
      );
    expect(blocked).toHaveLength(1);
  });

  it('BREAK: members without review rights are refused; double reviews apply once', async () => {
    const theirs = await record(author, 'Injector redesign');
    const bystander = await bot.member({ roles: ['verified'] });
    const queue = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'review',
      user: bystander.user,
    });
    expect(queue.interaction.lastText()).toContain('QUEUE CLEAR');
    const forged = await bot.run({
      kind: 'button',
      name: customId('projects', 'cverify', theirs.id, 0),
      user: bystander.user,
    });
    expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const forgedReject = await bot.run({
      kind: 'modal',
      name: customId('projects', 'creject', theirs.id, 0),
      user: bystander.user,
      modalText: { reason: 'I do not like it' },
    });
    expect(forgedReject.interaction.lastText()).toContain('ACCESS RESTRICTED');

    await bot.run({
      kind: 'button',
      name: customId('projects', 'cverify', theirs.id, 0),
      user: owner.user,
    });
    const again = await bot.run({
      kind: 'button',
      name: customId('projects', 'cverify', theirs.id, 0),
      user: owner.user,
    });
    expect(again.interaction.lastText()).toContain('already verified');
    const accepted = await bot.kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.sourceId, theirs.id));
    expect(accepted).toHaveLength(1);
  });

  it('/contribute list shows others only their verified contributions', async () => {
    const verified = await record(author, 'Verified work');
    await projects.verifyContribution(bot.kit.as(owner.actor), { contributionId: verified.id });
    await record(author, 'Pending work');
    const bystander = await bot.member({ roles: ['verified'] });
    const list = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'list',
      user: bystander.user,
      options: { member: author.user },
    });
    const text = list.interaction.lastText();
    expect(text).toContain('Verified work');
    expect(text).not.toContain('Pending work');
    const own = await bot.run({
      kind: 'slash',
      name: 'contribute',
      subcommand: 'list',
      user: author.user,
      options: { status: 'submitted' },
    });
    expect(own.interaction.lastText()).toContain('Pending work');
    expect(own.interaction.lastText()).not.toContain('Verified work');
  });

  it('the queue pages with SKIP and survives an out-of-range index', async () => {
    const first = await record(author, 'First');
    const second = await record(author, 'Second');
    const skip = await bot.run({
      kind: 'button',
      name: customId('projects', 'cq', 1),
      user: owner.user,
    });
    expect(skip.interaction.lastText()).toContain('2/2');
    const ids = [first.id, second.id];
    expect(ids.some((id) => customIds(skip.interaction.lastPayload()).join().includes(id))).toBe(
      true,
    );
    const end = await bot.run({
      kind: 'button',
      name: customId('projects', 'cq', 2),
      user: owner.user,
    });
    expect(end.interaction.lastText()).toContain('END OF QUEUE');
    const garbage = await bot.run({
      kind: 'button',
      name: customId('projects', 'cq', 'NaN'),
      user: owner.user,
    });
    expect(garbage.interaction.lastText()).toContain('1/2');
  });

  describe('Record Contribution (message context menu)', () => {
    const CHANNEL_ID = '500000000000000002';
    const MESSAGE_ID = '500000000000000001';
    const MESSAGE_URL = `https://discord.com/channels/${TEST_GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`;

    function message(by: InteractionUser, content: string, webhookId: string | null = null) {
      return {
        id: MESSAGE_ID,
        channelId: CHANNEL_ID,
        guildId: TEST_GUILD_ID,
        content,
        url: MESSAGE_URL,
        author: by,
        createdAt: bot.kit.clock.now(),
        attachments: [],
        embedsText: [],
        webhookId,
      };
    }

    /** Prefilled text input values of a modal, by custom id. */
    function inputValues(modal: unknown): Record<string, string | undefined> {
      const found: Record<string, string | undefined> = {};
      const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (record.type === ComponentType.TextInput && typeof record.custom_id === 'string')
          found[record.custom_id] = typeof record.value === 'string' ? record.value : undefined;
        Object.values(record).forEach(visit);
      };
      visit(modal);
      return found;
    }

    it('opens the modal prefilled from your own message and records it', async () => {
      const opened = await bot.run({
        kind: 'message_context',
        name: 'Record Contribution',
        user: author.user,
        targetMessage: message(
          author.user,
          '\n   Shipped the telemetry dashboard <@123456789012345678>\nDetails in thread.',
        ),
      });
      const response = opened.interaction.responses[0];
      expect(response?.type).toBe('modal');
      const values = inputValues(response?.type === 'modal' ? response.modal : null);
      expect(values).toMatchObject({
        title: 'Shipped the telemetry dashboard <@123456789012345678>',
        url: MESSAGE_URL,
      });
      const submitted = await bot.run({
        kind: 'modal',
        name: customId('projects', 'contribute', 'none'),
        user: author.user,
        modalText: { title: values.title!, url: values.url! },
        modalSelect: { kind: ['code'] },
      });
      expect(submitted.interaction.lastText()).toContain('CONTRIBUTION RECORDED');
      expect(submitted.interaction.lastText()).not.toMatch(/<@\d+>/);
      const [row] = await bot.kit.db.select().from(contributions);
      expect(row).toMatchObject({
        memberId: author.actor.memberId,
        status: 'submitted',
        url: MESSAGE_URL,
      });
    });

    it('BREAK: nobody records someone else’s message (or a webhook’s) as their work', async () => {
      const others = await bot.run({
        kind: 'message_context',
        name: 'Record Contribution',
        user: author.user,
        targetMessage: message(owner.user, 'Owner shipped the engine'),
      });
      expect(others.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      expect(others.interaction.lastText()).toContain('NOT YOUR MESSAGE');
      const webhook = await bot.run({
        kind: 'message_context',
        name: 'Record Contribution',
        user: author.user,
        targetMessage: message(author.user, 'Deploy finished', '500000000000000009'),
      });
      expect(webhook.interaction.lastText()).toContain('NOT YOUR MESSAGE');
      expect(await bot.kit.db.select().from(contributions)).toHaveLength(0);
    });

    it('derives a usable title from the first non-empty line only', () => {
      expect(titleFromMessage('\n\n  Faster parser  \nsecond line')).toBe('Faster parser');
      expect(titleFromMessage('ok')).toBe('');
      expect(titleFromMessage('   ')).toBe('');
      expect(titleFromMessage('x'.repeat(500))).toHaveLength(CONTRIBUTION_TITLE_MAX);
    });
  });
});
