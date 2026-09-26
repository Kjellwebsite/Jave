import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, members, researchItems } from '@jave/database';
import { research, type UserActor } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import type { FakeInteraction } from '../../testing/fake-interaction';
import { type BotHarness, createBotHarness } from '../../testing/harness';
import { HARNESS_TIMEOUT_MS, SUITE, targetMessage } from '../ai/test-fixtures';

const DOI = '10.1038/s41586-020-2649-2';
const PAPER_MESSAGE = `Array programming with NumPy — worth a read https://doi.org/${DOI}`;
const UNKNOWN_ITEM = '00000000-0000-4000-8000-000000000000';

/** TEST-ONLY Sidus transport: records pushes and answers like a healthy Sidus. */
class RecordingSidusClient implements research.SidusClient {
  readonly configured = true;
  readonly pushed: research.SidusResearchItem[] = [];
  async pushItem(item: research.SidusResearchItem) {
    this.pushed.push(item);
    return { externalId: 'sidus-0042' };
  }
  async health() {
    return { ok: true, detail: 'recording client' };
  }
}

function componentIds(interaction: FakeInteraction): string[] {
  return (interaction.lastPayload()?.components ?? []).flatMap((r) =>
    r.components.map((c) => ('custom_id' in c ? c.custom_id : '')),
  );
}

function linkUrls(interaction: FakeInteraction): string[] {
  return (interaction.lastPayload()?.components ?? []).flatMap((r) =>
    r.components.map((c) => ('url' in c && typeof c.url === 'string' ? c.url : '')),
  );
}

function modalId(interaction: FakeInteraction): string {
  const response = interaction.responses[0];
  return response && 'modal' in response ? response.modal.custom_id : '';
}

describe('research feature', SUITE, () => {
  let bot: BotHarness;
  let sidus: RecordingSidusClient;
  let member: { user: InteractionUser; actor: UserActor };
  let reviewer: { user: InteractionUser; actor: UserActor };

  beforeEach(async () => {
    sidus = new RecordingSidusClient();
    bot = await createBotHarness({ researchJobs: { resolvers: [], sidus } });
    member = await bot.member({ roles: ['verified'], username: 'nova' });
    reviewer = await bot.member({ roles: ['operations'], username: 'rhea' });
  }, HARNESS_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HARNESS_TIMEOUT_MS);

  async function saveMessage(user: InteractionUser, content = PAPER_MESSAGE) {
    return bot.run({
      kind: 'message_context',
      name: 'Save to Sidus',
      user,
      targetMessage: targetMessage(content),
    });
  }

  async function savedItemId(): Promise<string> {
    const [row] = await bot.kit.db.select().from(researchItems);
    if (!row) throw new Error('no research item saved');
    return row.id;
  }

  describe('Save to Sidus', () => {
    it('saves the message as a NEW item with its DOI and shows DUPLICATE the second time', async () => {
      const { interaction } = await saveMessage(member.user);
      expect(interaction.responses[0]).toEqual({ type: 'defer', ephemeral: true });
      expect(interaction.lastPayload()!.ephemeral).toBe(true);
      const text = interaction.lastText();
      expect(text).toContain('SAVED TO SIDUS — NEW');
      expect(text).toContain(`DOI \`${DOI}\``);
      expect(linkUrls(interaction)).toContain(`https://doi.org/${DOI}`);
      const [row] = await bot.kit.db.select().from(researchItems);
      expect(row).toMatchObject({ doi: DOI, submittedByUserId: member.actor.userId });
      expect(row!.discordMessageUrl).toMatch(/^https:\/\/discord\.com\/channels\//);
      // Member without review rights: no REVIEW control.
      expect(componentIds(interaction).filter(Boolean)).toEqual([]);

      const again = await saveMessage(member.user, `Same paper: doi:${DOI}`);
      expect(again.interaction.lastText()).toContain('DUPLICATE — ALREADY IN THE LIBRARY');
      expect(await bot.kit.db.select().from(researchItems)).toHaveLength(1);
    });

    it('BREAK: messages without a reference, foreign guilds and restricted members save nothing', async () => {
      const none = await saveMessage(member.user, 'gm all');
      expect(none.interaction.lastText()).toContain('No research reference found');

      const foreign = await bot.run({
        kind: 'message_context',
        name: 'Save to Sidus',
        user: member.user,
        targetMessage: targetMessage(PAPER_MESSAGE, { guildId: '222222222222222222' }),
      });
      expect(foreign.interaction.lastText()).toContain('JAVELIN channels only');

      await bot.kit.db
        .update(members)
        .set({ standing: 'restricted' })
        .where(eq(members.id, member.actor.memberId!));
      const restricted = await saveMessage(member.user);
      expect(restricted.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(await bot.kit.db.select().from(researchItems)).toHaveLength(0);
    });

    it('BREAK: a duplicate of an item archived by someone else is named, never shown', async () => {
      await saveMessage(reviewer.user);
      const itemId = await savedItemId();
      await research.archiveResearchItem(bot.kit.as(reviewer.actor), { itemId });
      const { interaction } = await saveMessage(member.user);
      expect(interaction.lastText()).toContain('DUPLICATE — ALREADY IN THE LIBRARY');
      expect(interaction.lastText()).toContain('(archived)');
      expect(interaction.lastText()).not.toContain('Array programming');
    });
  });

  describe('/sidus', () => {
    it('recent and search list items; the select opens a card', async () => {
      await saveMessage(member.user);
      const recent = await bot.run({ kind: 'slash', name: 'sidus', subcommand: 'recent', user: member.user });
      expect(recent.interaction.lastText()).toContain('RECENT RESEARCH');
      expect(recent.interaction.lastText()).toContain('Array programming with NumPy');
      const [select] = componentIds(recent.interaction);
      expect(select).toBe(customId('research', 'open'));

      const opened = await bot.run({
        kind: 'select',
        name: select!,
        user: member.user,
        values: [await savedItemId()],
      });
      expect(opened.interaction.lastText()).toContain('RESEARCH ITEM');

      const hit = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'search',
        user: member.user,
        options: { query: 'numpy' },
      });
      expect(hit.interaction.lastText()).toContain('Array programming with NumPy');
      const miss = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'search',
        user: member.user,
        options: { query: 'quantum gravity' },
      });
      expect(miss.interaction.lastText()).toContain('No item matches');
      expect(componentIds(miss.interaction)).toEqual([]);
    });

    it('view autocompletes items and refuses forged or unknown ids', async () => {
      await saveMessage(member.user);
      const auto = await bot.run({
        kind: 'autocomplete',
        name: 'sidus',
        subcommand: 'view',
        user: member.user,
        focused: { name: 'item', value: 'NumPy' },
      });
      const response = auto.interaction.responses[0];
      const choices = response && 'choices' in response ? response.choices : [];
      expect(choices).toHaveLength(1);
      expect(choices[0]!.value).toBe(await savedItemId());

      const forged = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'view',
        user: member.user,
        options: { item: "x' OR 1=1 --" },
      });
      expect(forged.interaction.lastText()).toContain('Choose an item from the list');
      const unknown = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'view',
        user: member.user,
        options: { item: UNKNOWN_ITEM },
      });
      expect(unknown.interaction.lastText()).toContain('NOT FOUND');
    });
  });

  describe('review and Sidus push', () => {
    it('a reviewer verifies through the modal, pushes to Sidus and the card reports SYNCED', async () => {
      await saveMessage(member.user);
      const itemId = await savedItemId();
      await bot.drain();
      const view = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'view',
        user: reviewer.user,
        options: { item: itemId },
      });
      expect(componentIds(view.interaction)).toContain(customId('research', 'review', itemId));

      const open = await bot.run({
        kind: 'button',
        name: customId('research', 'review', itemId),
        user: reviewer.user,
      });
      const formId = modalId(open.interaction);
      expect(formId).toMatch(new RegExp(`^research:review:${itemId}:\\d+$`));

      const reviewed = await bot.run({
        kind: 'modal',
        name: formId,
        user: reviewer.user,
        modalSelect: { status: ['verified'], evidence: ['peer_reviewed'] },
        modalText: { topic: 'Scientific computing', tags: 'numpy, Python , arrays', note: 'Checked.' },
      });
      const text = reviewed.interaction.lastText();
      expect(text).toContain('REVIEW RECORDED — VERIFIED');
      expect(text).toContain('PEER REVIEWED');
      expect(text).toContain('Scientific computing');
      const [row] = await bot.kit.db.select().from(researchItems);
      expect(row).toMatchObject({ status: 'verified', tags: ['numpy', 'python', 'arrays'] });
      expect(componentIds(reviewed.interaction)).toContain(customId('research', 'sync', itemId));

      const pushed = await bot.run({
        kind: 'button',
        name: customId('research', 'sync', itemId),
        user: reviewer.user,
      });
      expect(pushed.interaction.lastText()).toContain('SIDUS SYNC QUEUED');
      await bot.drain();
      expect(sidus.pushed).toHaveLength(1);
      expect(JSON.stringify(sidus.pushed[0])).not.toContain(member.actor.userId);
      const [synced] = await bot.kit.db.select().from(researchItems);
      expect(synced).toMatchObject({ sidusSyncStatus: 'synced', sidusExternalId: 'sidus-0042' });
      const card = await bot.run({
        kind: 'button',
        name: customId('research', 'view', itemId),
        user: member.user,
      });
      expect(card.interaction.lastText()).toContain('SYNCED');
    });

    it('BREAK: members, the submitter and stale or forged forms cannot review', async () => {
      await saveMessage(reviewer.user);
      const itemId = await savedItemId();

      const memberButton = await bot.run({
        kind: 'button',
        name: customId('research', 'review', itemId),
        user: member.user,
      });
      expect(memberButton.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(memberButton.interaction.responses.some((r) => r.type === 'modal')).toBe(false);

      const forgedModal = await bot.run({
        kind: 'modal',
        name: customId('research', 'review', itemId, 1),
        user: member.user,
        modalSelect: { status: ['verified'], evidence: ['meta_analysis'] },
      });
      expect(forgedModal.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const own = await bot.run({
        kind: 'slash',
        name: 'sidus',
        subcommand: 'review',
        user: reviewer.user,
        options: { item: itemId },
      });
      expect(own.interaction.lastText()).toContain('Nobody reviews their own submission');

      const ownForged = await bot.run({
        kind: 'modal',
        name: customId('research', 'review', itemId, 1),
        user: reviewer.user,
        modalSelect: { status: ['verified'], evidence: ['meta_analysis'] },
      });
      expect(ownForged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'research.self_review_blocked'));
      expect(denials).toHaveLength(1);

      const other = await bot.member({ roles: ['operations'] });
      const stale = await bot.run({
        kind: 'modal',
        name: customId('research', 'review', itemId, 999),
        user: other.user,
        modalSelect: { status: ['reviewed'], evidence: ['experimental'] },
      });
      expect(stale.interaction.lastText()).toContain('changed while you were reviewing');
      const noVersion = await bot.run({
        kind: 'modal',
        name: customId('research', 'review', itemId),
        user: other.user,
      });
      expect(noVersion.interaction.lastText()).toContain('EXPIRED');
      const [row] = await bot.kit.db.select().from(researchItems);
      const unknownEvidence = await bot.run({
        kind: 'modal',
        name: customId('research', 'review', itemId, row!.version),
        user: other.user,
        modalSelect: { status: ['verified'], evidence: ['unknown'] },
      });
      expect(unknownEvidence.interaction.lastText()).toContain('Set an evidence level');

      const memberSync = await bot.run({
        kind: 'button',
        name: customId('research', 'sync', itemId),
        user: member.user,
      });
      expect(memberSync.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const notVerified = await bot.run({
        kind: 'button',
        name: customId('research', 'sync', itemId),
        user: other.user,
      });
      expect(notVerified.interaction.lastText()).toContain('Only VERIFIED items sync');
      for (const name of [customId('research', 'view', 'nope'), customId('research', 'zap', itemId)]) {
        const junk = await bot.run({ kind: 'button', name, user: member.user });
        expect(junk.interaction.lastText()).toMatch(/Choose an item|EXPIRED/);
      }
      expect((await bot.kit.db.select().from(researchItems))[0]!.status).not.toBe('verified');
      expect(sidus.pushed).toHaveLength(0);
    });

    it('without Sidus credentials a push is recorded as not synced, never faked', async () => {
      const unconfigured = await createBotHarness();
      try {
        const author = await unconfigured.member({ roles: ['verified'] });
        const staff = await unconfigured.member({ roles: ['operations'] });
        await unconfigured.run({
          kind: 'message_context',
          name: 'Save to Sidus',
          user: author.user,
          targetMessage: targetMessage(PAPER_MESSAGE),
        });
        const [saved] = await unconfigured.kit.db.select().from(researchItems);
        await research.reviewResearchItem(unconfigured.kit.as(staff.actor), {
          itemId: saved!.id,
          expectedVersion: (await research.getResearchItem(unconfigured.kit.as(staff.actor), {
            itemId: saved!.id,
          })).version,
          status: 'verified',
          evidenceLevel: 'experimental',
        });
        await unconfigured.run({
          kind: 'button',
          name: customId('research', 'sync', saved!.id),
          user: staff.user,
        });
        await unconfigured.drain();
        const [row] = await unconfigured.kit.db.select().from(researchItems);
        expect(row).toMatchObject({ sidusSyncStatus: 'not_synced', sidusExternalId: null });
        expect(row!.sidusSyncError).toContain('not configured');
      } finally {
        await unconfigured.close();
      }
    });
  });
});
