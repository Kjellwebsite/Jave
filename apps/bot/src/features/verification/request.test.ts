import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, evidence, verificationEvidence, verifications } from '@jave/database';
import { submitEvidence, type UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import type { AutocompleteChoice, ModalPayload } from '../../interactions/types';
import type { FakeInteraction } from '../../testing/fake-interaction';
import {
  buttonLabels,
  controls,
  modalInputIds,
  modalOf,
  selectControl,
} from '../applications/testing/helpers';
import { createContribution, createProject } from './testing/fixtures';

interface ModalSelect {
  custom_id: string;
  max_values?: number;
  required?: boolean;
  options: { label: string; value: string; description?: string }[];
}

/** The select menu with `id` inside a modal's labels. */
function modalSelect(modal: ModalPayload, id: string): ModalSelect {
  const labels = modal.components as unknown as { component?: ModalSelect }[];
  const found = labels.find((label) => label.component?.custom_id === id)?.component;
  if (!found) throw new Error(`no select ${id} in modal`);
  return found;
}

function choices(interaction: FakeInteraction): AutocompleteChoice[] {
  const response = interaction.responses.find((r) => r.type === 'autocomplete');
  return response && 'choices' in response ? response.choices : [];
}

describe('verification — member request flow', () => {
  let bot: BotHarness;
  let member: { actor: UserActor; user: InteractionUser };

  beforeEach(async () => {
    bot = await createBotHarness();
    member = await bot.member({ roles: ['trial'], username: 'nova' });
  });
  afterEach(async () => {
    await bot.close();
  });

  it('select flow: type → project → modal → requested, with evidence', async () => {
    const projectId = await createProject(bot.kit, member.actor.memberId!, 'Orbit tracker');
    const start = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: member.user,
      subcommand: 'request',
    });
    const typePanel = start.interaction.lastPayload()!;
    expect(typePanel.ephemeral).toBe(true);
    expect(start.interaction.lastText()).toContain('WHAT SHOULD BE VERIFIED?');
    expect(selectControl(typePanel).options).toEqual([
      'skill',
      'project',
      'contribution',
      'achievement',
      'trial',
      'identity',
    ]);

    const chosen = await bot.run({
      kind: 'select',
      name: selectControl(typePanel).customId!,
      user: member.user,
      values: ['project'],
    });
    const targets = chosen.interaction.lastPayload()!;
    expect(chosen.interaction.responses[0]!.type).toBe('update');
    expect(selectControl(targets).options).toEqual([projectId]);

    const picked = await bot.run({
      kind: 'select',
      name: selectControl(targets).customId!,
      user: member.user,
      values: [projectId],
    });
    const modal = modalOf(picked.interaction);
    expect(modal.custom_id).toBe(`verification:submit:project:${projectId}`);
    expect(modal.title).toBe('VERIFY — PROJECT');
    expect(modalInputIds(modal)).toEqual(['claim', 'evidence1', 'evidence2', 'evidence3']);

    const submitted = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: member.user,
      modalText: {
        claim: 'I built the orbit propagator end to end.',
        evidence1: 'https://github.com/example/orbit',
        evidence2: ' ',
        evidence3: 'https://example.org/',
      },
    });
    const text = submitted.interaction.lastText();
    expect(text).toContain('VERIFICATION REQUESTED — VER-0001');
    expect(text).toContain('PROJECT: Orbit tracker');
    expect(text).toContain('2 evidence items attached.');
    const rows = await bot.kit.db.select().from(evidence);
    expect(rows.map((row) => row.title).sort()).toEqual([
      'example.org',
      'github.com/example/orbit',
    ]);
    const [request] = await bot.kit.db.select().from(verifications);
    expect(request).toMatchObject({
      status: 'pending',
      claim: 'I built the orbit propagator end to end.',
    });
  });

  it('attaches evidence the member already added, beside new links', async () => {
    const ctx = bot.kit.as(member.actor);
    const older = await submitEvidence(ctx, {
      title: 'Conference talk recording',
      url: 'https://example.org/talk',
    });
    const research = await submitEvidence(ctx, {
      title: 'Replication study',
      url: 'https://example.org/replication',
      facetKey: 'mind.research',
    });
    const turnedDown = await submitEvidence(ctx, { title: 'Blog post', kind: 'other' });
    await bot.kit.db
      .update(evidence)
      .set({ status: 'rejected' })
      .where(eq(evidence.id, turnedDown.id));

    const rank = await bot.run({
      kind: 'select',
      name: customId('verification', 'rank', 'mind.research'),
      user: member.user,
      values: ['A'],
    });
    const modal = modalOf(rank.interaction);
    expect(modalInputIds(modal)).toEqual([
      'claim',
      'evidence1',
      'evidence2',
      'evidence3',
      'existing',
    ]);
    const select = modalSelect(modal, 'existing');
    // Evidence for this capability first; nothing a verifier already rejected.
    expect(select.options.map((option) => option.value)).toEqual([research.id, older.id]);
    expect(select.options[0]).toMatchObject({
      label: 'Replication study',
      description: 'example.org/replication',
    });
    expect(select.max_values).toBe(2);
    expect(select.required).toBe(false);

    const submitted = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: member.user,
      modalText: { evidence1: 'https://example.org/dataset' },
      modalSelect: { existing: [research.id, older.id] },
    });
    expect(submitted.interaction.lastText()).toContain('3 evidence items attached.');
    const [row] = await bot.kit.db.select().from(verifications);
    const linked = await bot.kit.db
      .select()
      .from(verificationEvidence)
      .where(eq(verificationEvidence.verificationId, row!.id));
    expect(linked.map((link) => link.evidenceId)).toEqual(
      expect.arrayContaining([research.id, older.id]),
    );
  });

  it('skill flow asks for a capability, then a rank above the verified one', async () => {
    const chosen = await bot.run({
      kind: 'select',
      name: customId('verification', 'type'),
      user: member.user,
      values: ['skill'],
    });
    expect(selectControl(chosen.interaction.lastPayload()).options).toContain('mind.research');
    const facet = await bot.run({
      kind: 'select',
      name: customId('verification', 'target', 'skill'),
      user: member.user,
      values: ['mind.research'],
    });
    const ranks = selectControl(facet.interaction.lastPayload());
    expect(ranks.options).toEqual(['S', 'A', 'B', 'C', 'D', 'E', 'F']);
    const rank = await bot.run({
      kind: 'select',
      name: ranks.customId!,
      user: member.user,
      values: ['A'],
    });
    const modal = modalOf(rank.interaction);
    expect(modal.title).toBe('VERIFY — SKILL AT A');
    const submitted = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: member.user,
      modalText: { claim: '', evidence1: 'https://example.org/replication' },
    });
    expect(submitted.interaction.lastText()).toContain('SKILL: Research at A');
    const [row] = await bot.kit.db.select().from(verifications);
    expect(row).toMatchObject({ type: 'skill', facetKey: 'mind.research', requestedRank: 'A' });
  });

  it('identity goes straight to the form; slash options with autocomplete skip the selects', async () => {
    const identity = await bot.run({
      kind: 'select',
      name: customId('verification', 'type'),
      user: member.user,
      values: ['identity'],
    });
    expect(modalOf(identity.interaction).custom_id).toBe('verification:submit:identity');

    const contributionId = await createContribution(bot.kit, member.actor.memberId!, 'Parser');
    const suggestions = await bot.run({
      kind: 'autocomplete',
      name: 'verify',
      user: member.user,
      subcommand: 'request',
      options: { type: 'contribution' },
      focused: { name: 'target', value: 'pars' },
    });
    expect(choices(suggestions.interaction)).toEqual([
      { name: 'Parser · CODE', value: contributionId },
    ]);
    const direct = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: member.user,
      subcommand: 'request',
      options: { type: 'contribution', target: contributionId },
    });
    expect(modalOf(direct.interaction).custom_id).toBe(
      `verification:submit:contribution:${contributionId}`,
    );

    const rankSuggestions = await bot.run({
      kind: 'autocomplete',
      name: 'verify',
      user: member.user,
      subcommand: 'request',
      options: { type: 'skill', target: 'create.technical' },
      focused: { name: 'rank', value: 'a' },
    });
    expect(choices(rankSuggestions.interaction)).toEqual([{ name: 'A', value: 'A' }]);
    const noType = await bot.run({
      kind: 'autocomplete',
      name: 'verify',
      user: member.user,
      subcommand: 'request',
      focused: { name: 'target', value: '' },
    });
    expect(choices(noType.interaction)).toEqual([]);
  });

  it('says so when there is nothing of a type to verify', async () => {
    const { interaction } = await bot.run({
      kind: 'select',
      name: customId('verification', 'type'),
      user: member.user,
      values: ['trial'],
    });
    expect(interaction.lastText()).toContain('NOTHING TO VERIFY — TRIAL');
    expect(buttonLabels(interaction.lastPayload())).toEqual(['CHOOSE ANOTHER TYPE']);
  });

  it('/verify status lists my requests and opens one privately', async () => {
    const empty = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: member.user,
      subcommand: 'status',
    });
    expect(empty.interaction.lastText()).toContain('NO VERIFICATIONS YET');
    const projectId = await createProject(bot.kit, member.actor.memberId!);
    await bot.run({
      kind: 'modal',
      name: customId('verification', 'submit', 'project', projectId),
      user: member.user,
      modalText: {},
    });
    const list = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: member.user,
      subcommand: 'status',
    });
    expect(list.interaction.lastText()).toContain('VER-0001');
    const listLink = controls(list.interaction.lastPayload()).find((c) => c.type === 'link');
    expect(listLink?.url).toBe('https://jave.test/verification?status=all');
    const select = selectControl(list.interaction.lastPayload());
    const detail = await bot.run({
      kind: 'select',
      name: select.customId!,
      user: member.user,
      values: [select.options[0]!],
    });
    expect(detail.interaction.lastText()).toContain('VER-0001 — PROJECT');
    expect(detail.interaction.lastText()).toContain('PENDING');
    // The subject gets no verifier controls, only their own record in the dashboard.
    expect(buttonLabels(detail.interaction.lastPayload())).toEqual(['OPEN IN DASHBOARD']);
  });

  describe('BREAK', () => {
    it('typed autocomplete values are validated before they reach a custom id', async () => {
      for (const [options, message] of [
        [{ type: 'project', target: 'a:b:c' }, 'Choose a target from the list.'],
        [{ type: 'skill', target: 'mind.research:evil', rank: 'A' }, 'Unknown capability.'],
        [{ type: 'skill', target: 'mind.research', rank: 'A:B' }, 'Unknown rank.'],
        [{ type: 'godmode' }, 'Unknown verification type.'],
      ] as const) {
        const { interaction, outcome } = await bot.run({
          kind: 'slash',
          name: 'verify',
          user: member.user,
          subcommand: 'request',
          options,
        });
        expect(interaction.lastText()).toContain(message);
        expect(outcome.errorId).toBeNull();
      }
    });

    it('someone else’s targets and verifications look like nothing at all', async () => {
      const other = await bot.member({ roles: ['trial'] });
      const theirProject = await createProject(bot.kit, other.actor.memberId!);
      const theirContribution = await createContribution(bot.kit, other.actor.memberId!);
      for (const name of [
        customId('verification', 'submit', 'project', theirProject),
        customId('verification', 'submit', 'contribution', theirContribution),
      ]) {
        const { interaction } = await bot.run({ kind: 'modal', name, user: member.user });
        expect(interaction.lastText()).toContain('NOT FOUND');
      }
      const ownProject = await createProject(bot.kit, other.actor.memberId!);
      await bot.run({
        kind: 'modal',
        name: customId('verification', 'submit', 'project', ownProject),
        user: other.user,
      });
      const [theirs] = await bot.kit.db.select().from(verifications);
      const peek = await bot.run({
        kind: 'select',
        name: customId('verification', 'mine'),
        user: member.user,
        values: [theirs!.id],
      });
      expect(peek.interaction.lastText()).toContain('NOT FOUND');
      const denied = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'access.denied'));
      expect(denied.some((row) => row.targetId === theirs!.id)).toBe(true);
    });

    it('hostile evidence and claims are refused or escaped', async () => {
      const projectId = await createProject(bot.kit, member.actor.memberId!);
      const name = customId('verification', 'submit', 'project', projectId);
      const script = await bot.run({
        kind: 'modal',
        name,
        user: member.user,
        modalText: { evidence1: 'javascript:alert(1)' },
      });
      expect(script.interaction.lastText()).toContain('INVALID INPUT');
      const creds = await bot.run({
        kind: 'modal',
        name,
        user: member.user,
        modalText: { evidence1: 'https://user:pass@example.org/' },
      });
      expect(creds.interaction.lastText()).toContain('INVALID INPUT');
      const nul = await bot.run({
        kind: 'modal',
        name,
        user: member.user,
        modalText: { claim: 'bad\u0000claim' },
      });
      expect(nul.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(verifications)).toHaveLength(0);

      const loud = await bot.run({
        kind: 'modal',
        name,
        user: member.user,
        modalText: { claim: '@everyone <@123456789012345678> built __all__ of it' },
      });
      const text = loud.interaction.lastText();
      expect(text).toContain('VERIFICATION REQUESTED');
      const status = await bot.run({
        kind: 'select',
        name: customId('verification', 'mine'),
        user: member.user,
        values: [(await bot.kit.db.select().from(verifications))[0]!.id],
      });
      const detail = status.interaction.lastText();
      expect(detail).not.toContain('@everyone');
      expect(detail).not.toMatch(/<@\d{17,20}>/);
      expect(detail).toContain('\\_\\_all\\_\\_');
    });

    it('someone else’s evidence cannot be attached through a forged select value', async () => {
      const other = await bot.member({ roles: ['trial'] });
      const theirs = await submitEvidence(bot.kit.as(other.actor), {
        title: 'Their private evidence',
        url: 'https://example.org/theirs',
      });
      const projectId = await createProject(bot.kit, member.actor.memberId!);
      const forged = await bot.run({
        kind: 'modal',
        name: customId('verification', 'submit', 'project', projectId),
        user: member.user,
        modalSelect: { existing: [theirs.id] },
      });
      expect(forged.interaction.lastText()).toContain('One or more evidence items were not found.');
      const junk = await bot.run({
        kind: 'modal',
        name: customId('verification', 'submit', 'project', projectId),
        user: member.user,
        modalSelect: { existing: ['not-an-id'] },
      });
      expect(junk.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(verifications)).toHaveLength(0);
      expect(await bot.kit.db.select().from(verificationEvidence)).toHaveLength(0);
    });

    it('a forged skill submit without a rank, or an unknown type, is refused', async () => {
      const cases = [
        [customId('verification', 'submit', 'skill', 'mind.research', ''), 'Choose a rank.'],
        [customId('verification', 'submit', 'wizardry'), 'Unknown verification type.'],
        [customId('verification', 'submit', 'project'), 'Choose a target.'],
      ] as const;
      for (const [name, message] of cases) {
        const { interaction } = await bot.run({ kind: 'modal', name, user: member.user });
        expect(interaction.lastText(), name).toContain(message);
      }
    });
  });
});
