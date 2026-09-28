import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, jobs } from '@jave/database';
import { DISCORD_ROLE_SYNC_JOB, type UserActor } from '@jave/core';
import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  ComponentType,
} from 'discord.js';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { InteractionUser } from '../../interactions/types';
import type { FakeInteraction } from '../../testing/fake-interaction';

type Person = { actor: UserActor; user: InteractionUser };

function components(interaction: FakeInteraction): APIComponentInMessageActionRow[] {
  const rows = (interaction.lastPayload()?.components ??
    []) as APIActionRowComponent<APIComponentInMessageActionRow>[];
  return rows.flatMap((row) => row.components);
}

const customIds = (interaction: FakeInteraction) =>
  components(interaction).map((c) => ('custom_id' in c ? c.custom_id : null));

describe('/jave status: dead letters', () => {
  let bot: BotHarness;
  let founder: Person;
  let deadJobId: number;

  beforeEach(async () => {
    bot = await createBotHarness();
    founder = await bot.member({ roles: ['founder'] });
    const target = await bot.member({ roles: ['member'] });
    await bot.drain();
    const [dead] = await bot.kit.db
      .insert(jobs)
      .values({
        type: DISCORD_ROLE_SYNC_JOB,
        payload: { memberId: target.actor.memberId! },
        status: 'dead',
        attempts: 5,
        maxAttempts: 5,
        lastError: 'Missing Permissions <@&500000000000000001> **@everyone**',
        runAt: bot.kit.clock.now(),
      })
      .returning({ id: jobs.id });
    deadJobId = dead!.id;
  });
  afterEach(async () => {
    await bot.close();
  });

  const status = (user: InteractionUser) =>
    bot.run({ kind: 'slash', name: 'jave', user, subcommand: 'status' });
  const press = (user: InteractionUser, id: string, values?: string[]) =>
    bot.run({ kind: values ? 'select' : 'button', name: id, user, values });

  it('offers the dead letters to staff and retries one for a settings manager', async () => {
    const report = await status(founder.user);
    expect(components(report.interaction)).toMatchObject([
      { custom_id: 'jobs:dead', label: 'DEAD LETTERS · 1' },
    ]);

    const list = await press(founder.user, 'jobs:dead');
    expect(list.interaction.responses[0]?.type).toBe('update');
    const text = list.interaction.lastText();
    expect(text).toContain(`#${deadJobId}`);
    expect(text).toContain('5/5 attempts');
    // Error text is escaped: no live role mention, no markdown.
    expect(text).not.toContain('<@&500000000000000001>');
    expect(text).not.toContain('**@everyone**');
    expect(customIds(list.interaction)).toEqual(['jobs:retry', 'jobs:dead']);
    expect(components(list.interaction)[0]).toMatchObject({ type: ComponentType.StringSelect });

    const retried = await press(founder.user, 'jobs:retry', [String(deadJobId)]);
    expect(retried.interaction.lastText()).toContain('JOB REQUEUED');
    expect(retried.interaction.lastText()).toContain('None.');
    const [job] = await bot.kit.db.select().from(jobs).where(eq(jobs.id, deadJobId));
    expect(job!.status).toBe('completed');
    const [audit] = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'job.retried'), eq(auditLogs.targetId, String(deadJobId))));
    expect(audit!.actorUserId).toBe(founder.actor.userId);
  });

  it('moderators see the dead letters but cannot retry, even with a forged select', async () => {
    const moderator = await bot.member({ roles: ['moderator'] });
    const list = await press(moderator.user, 'jobs:dead');
    expect(list.interaction.lastText()).toContain(`#${deadJobId}`);
    expect(customIds(list.interaction)).toEqual(['jobs:dead']);

    const forged = await press(moderator.user, 'jobs:retry', [String(deadJobId)]);
    expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const [job] = await bot.kit.db.select().from(jobs).where(eq(jobs.id, deadJobId));
    expect(job!.status).toBe('dead');
  });

  it('BREAK: members get no button and cannot open the list with a forged id', async () => {
    const member = await bot.member({ roles: ['verified'] });
    const report = await status(member.user);
    expect(components(report.interaction)).toEqual([]);
    const forged = await press(member.user, 'jobs:dead');
    expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(forged.interaction.lastText()).not.toContain('Missing Permissions');
  });

  it('BREAK: junk, stale and unknown retry targets are refused', async () => {
    const junk = await press(founder.user, 'jobs:retry', ['1; drop table jobs']);
    expect(junk.interaction.lastText()).toContain('Choose a job.');
    const huge = await press(founder.user, 'jobs:retry', ['99999999999999999999']);
    expect(huge.interaction.lastText()).toContain('Choose a job.');
    const missing = await press(founder.user, 'jobs:retry', ['424242']);
    expect(missing.interaction.lastText()).toContain('NOT FOUND');

    await press(founder.user, 'jobs:retry', [String(deadJobId)]);
    const again = await press(founder.user, 'jobs:retry', [String(deadJobId)]);
    expect(again.interaction.lastText()).toContain('Only dead-lettered jobs can be retried.');
    const unknown = await press(founder.user, 'jobs:purge');
    expect(unknown.interaction.lastText()).toContain('EXPIRED');
  });

  it('shows no button when the queue has no dead letters', async () => {
    await bot.kit.db.delete(jobs).where(eq(jobs.id, deadJobId));
    const report = await status(founder.user);
    expect(components(report.interaction)).toEqual([]);
  });
});
