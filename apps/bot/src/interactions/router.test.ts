import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { ForbiddenError, requireMember } from '@jave/core';
import { createBotHarness, discordUser, type BotHarness } from '../testing/harness';
import type { BotFeature } from '../features/types';
import { customId } from './custom-id';
import { INTERACTION_LIMIT } from './router';

const probe: BotFeature = {
  name: 'probe',
  commands: [
    {
      kind: 'slash',
      data: new SlashCommandBuilder().setName('boom').setDescription('throws').toJSON(),
      async execute() {
        throw new Error('database exploded: password=hunter2');
      },
    },
    {
      kind: 'slash',
      data: new SlashCommandBuilder()
        .setName('forbidden')
        .setDescription('throws forbidden')
        .toJSON(),
      async execute() {
        throw new ForbiddenError('Staff only.');
      },
    },
    {
      kind: 'slash',
      data: new SlashCommandBuilder().setName('staffonly').setDescription('gated').toJSON(),
      requires: 'canManageSettings',
      async execute(h) {
        await h.respond({ content: 'secret panel', ephemeral: true });
      },
    },
    {
      kind: 'slash',
      data: new SlashCommandBuilder().setName('slow').setDescription('deferred').toJSON(),
      defer: 'ephemeral',
      async execute(h) {
        requireMember(h.ctx);
        await h.respond({ content: 'done' });
      },
    },
  ],
  components: [
    {
      namespace: 'probe',
      async handle(h, action, args) {
        await h.respond({ content: `${action}:${args.join(',')}`, ephemeral: true });
      },
    },
  ],
};

describe('InteractionRouter', () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = await createBotHarness({ features: [probe] });
  });
  afterEach(async () => {
    await bot.close();
  });

  it('refuses interactions from other guilds', async () => {
    const { interaction, outcome } = await bot.run({
      kind: 'slash',
      name: 'slow',
      user: discordUser('200000000000000001'),
      guildId: '300000000000000000',
    });
    expect(outcome.outcome).toBe('rejected');
    expect(interaction.lastText()).toContain('only inside JAVELIN');
  });

  it('creates the member on first contact and runs deferred handlers', async () => {
    const { interaction, outcome } = await bot.run({
      kind: 'slash',
      name: 'slow',
      user: discordUser('200000000000000002'),
    });
    expect(outcome.outcome).toBe('ok');
    expect(interaction.responses[0]).toEqual({ type: 'defer', ephemeral: true });
    expect(interaction.lastPayload()?.content).toBe('done');
  });

  it('BREAK: unexpected errors return only a reference id, never internals', async () => {
    const { interaction, outcome } = await bot.run({
      kind: 'slash',
      name: 'boom',
      user: discordUser('200000000000000003'),
    });
    expect(outcome.outcome).toBe('error');
    expect(outcome.errorId).toMatch(/^E-/);
    const text = interaction.lastText();
    expect(text).toContain(outcome.errorId!);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('exploded');
    expect(interaction.lastPayload()?.ephemeral).toBe(true);
  });

  it('renders expected errors with their safe message', async () => {
    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'forbidden',
      user: discordUser('200000000000000004'),
    });
    expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(interaction.lastText()).toContain('Staff only.');
  });

  it('BREAK: capability-gated commands refuse members', async () => {
    const { user } = await bot.member({ roles: ['verified'] });
    const { interaction } = await bot.run({ kind: 'slash', name: 'staffonly', user });
    expect(interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(interaction.lastText()).not.toContain('secret panel');
    const founder = await bot.member({ roles: ['founder'] });
    const ok = await bot.run({ kind: 'slash', name: 'staffonly', user: founder.user });
    expect(ok.interaction.lastPayload()?.content).toBe('secret panel');
  });

  it('routes components by namespace and reports expired controls', async () => {
    const user = discordUser('200000000000000005');
    const ok = await bot.run({ kind: 'button', name: customId('probe', 'go', 'a', 'b'), user });
    expect(ok.interaction.lastPayload()?.content).toBe('go:a,b');
    const stale = await bot.run({ kind: 'button', name: 'retired:thing', user });
    expect(stale.outcome.outcome).toBe('unknown');
    expect(stale.interaction.lastText()).toContain('no longer active');
  });

  it('BREAK: rate-limits interaction floods per user', async () => {
    const user = discordUser('200000000000000006');
    const outcomes = [];
    for (let i = 0; i < INTERACTION_LIMIT.max + 3; i++) {
      outcomes.push(
        (await bot.run({ kind: 'button', name: customId('probe', 'x'), user })).outcome.outcome,
      );
    }
    expect(outcomes.filter((o) => o === 'rejected')).toHaveLength(3);
  });

  it('ignores bot users', async () => {
    const { outcome } = await bot.run({
      kind: 'slash',
      name: 'slow',
      user: { ...discordUser('200000000000000007'), bot: true },
    });
    expect(outcome.outcome).toBe('rejected');
  });

  it('refuses custom ids that exceed Discord limits', () => {
    expect(() => customId('ns', 'a'.repeat(120))).toThrow(/too long/);
    expect(() => customId('ns', 'a:b')).toThrow(/contains/);
  });
});
