import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  adversarialRoles,
  auditLogs,
  jobs,
  notifications,
  trialParticipants,
} from '@jave/database';
import { ForbiddenError, ValidationError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';
import { ADVERSARIAL_ABORT_JOB } from './discord-jobs';
import { raiseRedFlag } from './red-flag.service';
import { briefRole } from './roles.service';
import { STOP_WORD_CHAT_NOTE, stopWordTyped } from './stop-word.service';
import {
  type AdversarialFixture,
  authorizeCurrent,
  INTEGRATION_TIMEOUT_MS,
  memberIdOf,
  planDefault,
  runToActive,
  setupAdversarial,
  TEAM_A_CHANNEL,
  TEAM_B_CHANNEL,
} from './test-fixtures';

/** A channel that belongs to no team. */
const GENERAL_CHANNEL = '399999999999999999';

vi.setConfig({ testTimeout: INTEGRATION_TIMEOUT_MS, hookTimeout: INTEGRATION_TIMEOUT_MS });
describe('adversarial: the stop word typed in Discord', () => {
  let kit: TestKit;
  let fx: AdversarialFixture;
  beforeEach(async () => {
    kit = await createTestKit();
    fx = await setupAdversarial(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  const roleRow = async (id: string) =>
    (await kit.db.select().from(adversarialRoles).where(eq(adversarialRoles.id, id)))[0]!;
  const alertsOf = async (actor: UserActor) =>
    (
      await kit.db
        .select()
        .from(notifications)
        .where(eq(notifications.recipientUserId, actor.userId))
    ).filter((n) => n.type === 'adversarial.alert');
  const auditCount = async () => (await kit.db.select().from(auditLogs)).length;
  const typed = (actor: UserActor, channelId: string | null) =>
    stopWordTyped(kit.system, { discordUserId: actor.discordId, channelId });

  it('the operative, anywhere in the server: the exercise stops, attributed to the operative', async () => {
    const role = await runToActive(fx);
    expect(await typed(fx.operative, GENERAL_CHANNEL)).toEqual([
      { roleId: role.id, typedBy: 'operative', stopped: true },
    ]);
    const row = await roleRow(role.id);
    expect(row.status).toBe('aborted');
    expect(row.redFlagRaisedByUserId).toBe(fx.operative.userId);
    expect(row.abortReason).toBe(`RED FLAG typed in chat by the operative: ${STOP_WORD_CHAT_NOTE}`);
    const [alert] = await alertsOf(fx.planner);
    expect(alert!.body).toContain('typed in chat by the operative');
    expect(alert!.body).not.toContain('staff');
    expect(
      await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_ABORT_JOB)),
    ).toHaveLength(1);
    // Idempotent; also without a channel.
    expect(await typed(fx.operative, null)).toEqual([]);
  });

  it('the operative of a briefed exercise stops it too', async () => {
    const role = await planDefault(fx);
    await authorizeCurrent(fx, role.id);
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    expect(await typed(fx.operative, null)).toEqual([
      { roleId: role.id, typedBy: 'operative', stopped: true },
    ]);
  });

  it('a participant’s words never stop the exercise: managers are alerted once, nothing is audited', async () => {
    const role = await runToActive(fx);
    const audits = await auditCount();
    for (const mate of [fx.teammates[0]!, fx.teammates[1]!, fx.teammates[0]!])
      expect(await typed(mate, TEAM_A_CHANNEL)).toEqual([
        { roleId: role.id, typedBy: 'participant', stopped: false },
      ]);
    expect((await roleRow(role.id)).status).toBe('active');
    expect(await kit.db.select().from(jobs).where(eq(jobs.type, ADVERSARIAL_ABORT_JOB))).toEqual(
      [],
    );
    for (const manager of [fx.founder, fx.planner, fx.authorizer]) {
      const alerts = await alertsOf(manager);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.title).toBe(`STOP WORD IN CHAT — TRIAL #${fx.trialNumber}`);
      expect(alerts[0]!.body).toContain('still running');
    }
    for (const person of [fx.operative, ...fx.teammates, fx.otherTeamMember])
      expect(await alertsOf(person)).toEqual([]);
    // An audit row at the moment of the message would be a tell for staff competing in the trial.
    expect(await auditCount()).toBe(audits);
    // Another team's channel, or a channel of no team, concerns no role.
    expect(await typed(fx.otherTeamMember, TEAM_B_CHANNEL)).toEqual([]);
    expect(await typed(fx.teammates[0]!, GENERAL_CHANNEL)).toEqual([]);
  });

  it('a participant mention while the exercise is only briefed alerts nobody', async () => {
    const role = await planDefault(fx);
    await authorizeCurrent(fx, role.id);
    await briefRole(kit.as(fx.planner), { roleId: role.id });
    expect(await typed(fx.teammates[0]!, TEAM_A_CHANNEL)).toEqual([
      { roleId: role.id, typedBy: 'participant', stopped: false },
    ]);
    expect(await alertsOf(fx.planner)).toEqual([]);
    expect((await roleRow(role.id)).status).toBe('briefed');
  });

  it('adversarial staff in the team channel stop the exercise, attributed to staff', async () => {
    const role = await runToActive(fx);
    expect(await typed(fx.planner, GENERAL_CHANNEL)).toEqual([]);
    expect(await typed(fx.planner, TEAM_A_CHANNEL)).toEqual([
      { roleId: role.id, typedBy: 'staff', stopped: true },
    ]);
    const row = await roleRow(role.id);
    expect(row.status).toBe('aborted');
    expect(row.redFlagRaisedByUserId).toBe(fx.planner.userId);
    expect(row.abortReason).toContain('typed in chat by staff');
    // The raiser is not alerted about their own stop; the other managers are.
    expect(await alertsOf(fx.planner)).toEqual([]);
    expect((await alertsOf(fx.authorizer))[0]!.body).toContain('typed in chat by staff');
  });

  it('BREAK: staff without the adversarial capability, or competing in the trial, count as participants', async () => {
    const role = await runToActive(fx);
    const competing = await kit.member({ roles: ['core'] });
    await kit.db.insert(trialParticipants).values({
      trialId: fx.trialId,
      memberId: memberIdOf(competing),
      status: 'selected',
      teamId: fx.teamAId,
    });
    const audits = await auditCount();
    expect(await typed(fx.operations, TEAM_A_CHANNEL)).toEqual([
      { roleId: role.id, typedBy: 'participant', stopped: false },
    ]);
    expect(await typed(competing, TEAM_A_CHANNEL)).toEqual([
      { roleId: role.id, typedBy: 'participant', stopped: false },
    ]);
    expect((await roleRow(role.id)).status).toBe('active');
    // No conflict-of-interest or denial record reveals the role to the competing staff member.
    expect(await auditCount()).toBe(audits);
    expect(await alertsOf(competing)).toEqual([]);
  });

  it('BREAK: an unknown Discord user in the team channel is a participant mention', async () => {
    const role = await runToActive(fx);
    expect(
      await stopWordTyped(kit.system, {
        discordUserId: '499999999999999999',
        channelId: TEAM_A_CHANNEL,
      }),
    ).toEqual([{ roleId: role.id, typedBy: 'participant', stopped: false }]);
    expect((await roleRow(role.id)).status).toBe('active');
  });

  it('BREAK: only the bot worker reports the stop word; input is validated', async () => {
    await runToActive(fx);
    await expect(
      stopWordTyped(kit.as(fx.operative), {
        discordUserId: fx.operative.discordId,
        channelId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      stopWordTyped(kit.system, { discordUserId: 'not-a-snowflake', channelId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a RED FLAG raised by the system actor is attributed to JAVE, never to staff', async () => {
    const role = await runToActive(fx);
    await raiseRedFlag(kit.system, { roleId: role.id });
    expect((await roleRow(role.id)).abortReason).toBe('RED FLAG raised by JAVE.');
  });
});
