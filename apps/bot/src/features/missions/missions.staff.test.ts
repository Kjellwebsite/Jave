import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  evidence,
  missionAssignments,
  missions as missionsTable,
  notificationDeliveries,
  notifications,
} from '@jave/database';
import { achievements, missions } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import type { InteractionUser } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import {
  BRIEF,
  customIds,
  EVIDENCE_URL,
  labels,
  modalOf,
  openMission,
  SUITE_TIMEOUTS,
} from './testing/fixtures';

vi.setConfig(SUITE_TIMEOUTS);

type Member = Awaited<ReturnType<BotHarness['member']>>;

describe('missions — staff flows', () => {
  let bot: BotHarness;
  let ops: Member;
  let core: Member;

  beforeEach(async () => {
    bot = await createBotHarness();
    ops = await bot.member({ roles: ['operations'], username: 'ops' });
    core = await bot.member({ roles: ['core'], username: 'core' });
  });
  afterEach(async () => {
    await bot.close();
  });

  function run(user: InteractionUser, subcommand: string, options = {}) {
    return bot.run({ kind: 'slash', name: 'mission', subcommand, user, options });
  }

  async function missionRow(id: string) {
    const [row] = await bot.kit.db.select().from(missionsTable).where(eq(missionsTable.id, id));
    return row!;
  }

  async function assignmentsOf(missionId: string) {
    return bot.kit.db
      .select()
      .from(missionAssignments)
      .where(eq(missionAssignments.missionId, missionId));
  }

  it('creates a draft from the modal, configures it in SETTINGS and edits it', async () => {
    const opened = await run(ops.user, 'create');
    const modal = modalOf(opened.interaction)!;
    expect(modal.custom_id).toBe(customId('missions', 'create'));

    const bad = await bot.run({
      kind: 'modal',
      name: customId('missions', 'create'),
      user: ops.user,
      modalText: { title: 'Prototype sprint', brief: BRIEF, deadline: '2026-02-30 10:00' },
      modalSelect: { type: ['build'] },
    });
    expect(bad.interaction.lastText()).toContain('INVALID INPUT');

    const created = await bot.run({
      kind: 'modal',
      name: customId('missions', 'create'),
      user: ops.user,
      modalText: { title: 'Prototype sprint', brief: BRIEF, hours: '72', deadline: '' },
      modalSelect: { type: ['build'] },
    });
    expect(created.interaction.lastText()).toContain('DRAFT CREATED');
    expect(created.interaction.lastText()).toContain('DRAFT');
    const [draft] = await bot.kit.db.select().from(missionsTable);
    expect(draft).toMatchObject({ status: 'draft', durationHours: 72, type: 'build' });
    expect(labels(created.interaction)).toEqual([
      'PUBLISH',
      'EDIT',
      'SETTINGS',
      'ARCHIVE',
      'DASHBOARD',
    ]);

    const settings = await bot.run({
      kind: 'button',
      name: customId('missions', 'settings', draft!.id),
      user: ops.user,
    });
    expect(settings.interaction.responses[0]?.type).toBe('update');
    expect(settings.interaction.lastText()).toContain('SETTINGS');
    const facet = await bot.run({
      kind: 'select',
      name: customId('missions', 'set_facet', draft!.id),
      user: ops.user,
      values: ['create.technical'],
    });
    expect(facet.interaction.lastText()).toContain('CAPABILITY UPDATED');
    await bot.run({
      kind: 'button',
      name: customId('missions', 'toggle_evidence', draft!.id),
      user: ops.user,
    });
    await bot.run({
      kind: 'select',
      name: customId('missions', 'set_type', draft!.id),
      user: ops.user,
      values: ['research'],
    });
    const forgedFacet = await bot.run({
      kind: 'select',
      name: customId('missions', 'set_facet', draft!.id),
      user: ops.user,
      values: ['charisma'],
    });
    expect(forgedFacet.interaction.lastText()).toContain('INVALID INPUT');
    expect(await missionRow(draft!.id)).toMatchObject({
      facetKey: 'create.technical',
      evidenceRequired: false,
      type: 'research',
    });

    const edit = await bot.run({
      kind: 'button',
      name: customId('missions', 'edit', draft!.id),
      user: ops.user,
    });
    expect(JSON.stringify(modalOf(edit.interaction))).toContain('Prototype sprint');
    const edited = await bot.run({
      kind: 'modal',
      name: customId('missions', 'edit', draft!.id),
      user: ops.user,
      modalText: {
        title: 'Prototype sprint II',
        brief: BRIEF,
        hours: '',
        deadline: '2026-12-01 18:00',
        slots: '4',
      },
    });
    expect(edited.interaction.lastText()).toContain('MISSION UPDATED');
    expect(await missionRow(draft!.id)).toMatchObject({
      title: 'Prototype sprint II',
      durationHours: null,
      maxAssignees: 4,
      deadlineAt: new Date('2026-12-01T18:00:00.000Z'),
    });
  });

  it('publishes a draft quietly or with the announcement, then closes and reopens it', async () => {
    const draft = await missions.createMission(bot.kit.as(ops.actor), {
      title: 'Prototype sprint',
      brief: BRIEF,
      type: 'build',
    });
    const asked = await run(ops.user, 'publish', { mission: draft.id });
    expect(customIds(asked.interaction)).toEqual([
      customId('missions', 'publish_go', draft.id, 1),
      customId('missions', 'publish_go', draft.id, 0),
    ]);
    const published = await bot.run({
      kind: 'button',
      name: customId('missions', 'publish_go', draft.id, 1),
      user: ops.user,
    });
    // No channel configured: published, nothing posted, and the copy says so.
    expect(published.interaction.lastText()).toContain('MISSION PUBLISHED');
    expect(published.interaction.lastText()).toContain('no card was posted');
    expect(bot.gateway.callsTo('sendMessage')).toHaveLength(0);
    expect(labels(published.interaction)).toEqual(
      expect.arrayContaining(['ASSIGN', 'CLOSE', 'EDIT', 'SETTINGS']),
    );

    const closed = await bot.run({
      kind: 'button',
      name: customId('missions', 'close', draft.id),
      user: ops.user,
    });
    expect(closed.interaction.lastText()).toContain('MISSION CLOSED');
    expect((await missionRow(draft.id)).status).toBe('closed');
    const reopened = await bot.run({
      kind: 'button',
      name: customId('missions', 'reopen', draft.id),
      user: ops.user,
    });
    expect(reopened.interaction.lastText()).toContain('MISSION REOPENED');
    const twice = await bot.run({
      kind: 'button',
      name: customId('missions', 'publish_go', draft.id, 1),
      user: ops.user,
    });
    expect(twice.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
  });

  it('assigns with the user select, reports skips, and handles team keys', async () => {
    const mission = await openMission(bot, ops.actor, { maxAssignees: 2 });
    const a = await bot.member({ roles: ['verified'], username: 'mara' });
    const b = await bot.member({ roles: ['verified'], username: 'jun' });
    const c = await bot.member({ roles: ['verified'], username: 'ilya' });
    const panel = await run(ops.user, 'assign', { mission: mission.id });
    expect(customIds(panel.interaction)).toEqual([
      customId('missions', 'assign_pick', mission.id, '-', '-'),
      customId('missions', 'assign_opts', mission.id),
    ]);
    const stranger = '400000000000000999';
    const picked = await bot.run({
      kind: 'select',
      name: customId('missions', 'assign_pick', mission.id, '-', '-'),
      user: ops.user,
      values: [a.user.id, b.user.id, c.user.id, stranger],
    });
    const text = picked.interaction.lastText();
    expect(text).toContain('2 ASSIGNED');
    expect(text).toContain('✓ mara');
    expect(text).toContain('✕ ilya — no slot left');
    expect(text).toContain(`✕ <@${stranger}> — no JVLN profile`);
    expect((await assignmentsOf(mission.id)).map((row) => row.status)).toEqual([
      'assigned',
      'assigned',
    ]);

    const self = await bot.run({
      kind: 'select',
      name: customId('missions', 'assign_pick', mission.id, '-', '-'),
      user: ops.user,
      values: [ops.user.id],
    });
    expect(self.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const [blocked] = await bot.kit.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'mission.self_assign_blocked'));
    expect(blocked).toBeDefined();

    const team = await openMission(bot, ops.actor, { title: 'Relay build', type: 'team' });
    const teamPanel = await bot.run({
      kind: 'button',
      name: customId('missions', 'assign', team.id),
      user: ops.user,
    });
    expect(teamPanel.interaction.lastText()).toContain('set a team key first');
    expect(customIds(teamPanel.interaction)).toEqual([
      customId('missions', 'assign_opts', team.id),
    ]);
    const badKey = await bot.run({
      kind: 'modal',
      name: customId('missions', 'assign_opts', team.id),
      user: ops.user,
      modalText: { team: 'Team One!', hours: '' },
    });
    expect(badKey.interaction.lastText()).toContain('INVALID INPUT');
    const withKey = await bot.run({
      kind: 'modal',
      name: customId('missions', 'assign_opts', team.id),
      user: ops.user,
      modalText: { team: 'Alpha', hours: '24' },
    });
    expect(customIds(withKey.interaction)[0]).toBe(
      customId('missions', 'assign_pick', team.id, 'alpha', 24),
    );
    await bot.run({
      kind: 'select',
      name: customId('missions', 'assign_pick', team.id, 'alpha', 24),
      user: ops.user,
      values: [a.user.id, c.user.id],
    });
    const rows = await assignmentsOf(team.id);
    expect(rows.map((row) => row.teamKey)).toEqual(['alpha', 'alpha']);
  });

  it('BREAK: forged team keys and hours in the picker id change nothing; closed DMs change nothing', async () => {
    const mission = await openMission(bot, ops.actor, { type: 'team', title: 'Relay build' });
    const a = await bot.member({ roles: ['verified'], username: 'mara' });
    for (const forged of [
      customId('missions', 'assign_pick', mission.id, 'Evil Key!', '-'),
      customId('missions', 'assign_pick', mission.id, 'alpha', 999_999),
    ]) {
      const picked = await bot.run({
        kind: 'select',
        name: forged,
        user: ops.user,
        values: [a.user.id],
      });
      expect(picked.interaction.lastText()).toContain('INVALID INPUT');
    }
    expect(await assignmentsOf(mission.id)).toHaveLength(0);

    bot.gateway.closedDms.add(a.user.id);
    const assigned = await bot.run({
      kind: 'select',
      name: customId('missions', 'assign_pick', mission.id, 'alpha', '-'),
      user: ops.user,
      values: [a.user.id],
    });
    expect(assigned.interaction.lastText()).toContain('1 ASSIGNED');
    await bot.drain();
    const [notice] = await bot.kit.db
      .select({ status: notificationDeliveries.status })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(
        and(
          eq(notifications.recipientUserId, a.actor.userId),
          eq(notificationDeliveries.channel, 'discord_dm'),
        ),
      );
    expect(notice?.status).toBe('skipped');
    expect(bot.gateway.dms).toHaveLength(0);
    expect((await assignmentsOf(mission.id)).map((row) => row.status)).toEqual(['assigned']);
  });

  it('reviews the queue: VERIFY with optional feedback, REJECT with required feedback', async () => {
    await achievements.seedStarterAchievements(bot.kit.as(core.actor));
    const mission = await openMission(bot, ops.actor, { facetKey: 'create.technical' });
    const a = await bot.member({ roles: ['verified'], username: 'mara' });
    const b = await bot.member({ roles: ['verified'], username: 'jun' });
    for (const who of [a, b]) {
      const assignment = await missions.selfAssignMission(bot.kit.as(who.actor), {
        missionId: mission.id,
      });
      await missions.submitMission(bot.kit.as(who.actor), {
        assignmentId: assignment.id,
        submission: `Work by ${who.user.username}. [click](https://evil.example) @everyone`,
        evidence: { title: 'Repository', url: EVIDENCE_URL },
      });
      bot.kit.clock.advance(1000);
    }
    const queue = await run(ops.user, 'review');
    const text = queue.interaction.lastText();
    expect(text).toContain('REVIEW QUEUE · 1 OF 2');
    expect(text).toContain('mara');
    // Submitted text is inert: markdown escaped, mentions neutralized.
    expect(text).toContain('\\[click\\]\\(https://evil.example\\)');
    expect(text).not.toContain(' @everyone');
    expect(text).toContain('Repository · `example.com`');
    const ids = customIds(queue.interaction);
    const [assignmentA] = (await assignmentsOf(mission.id)).filter(
      (row) => row.memberId === a.actor.memberId,
    );
    expect(ids).toContain(customId('missions', 'verify', assignmentA!.id, 0));
    expect(labels(queue.interaction)).toContain('OPEN EVIDENCE');

    const modal = await bot.run({
      kind: 'button',
      name: customId('missions', 'verify', assignmentA!.id, 0),
      user: ops.user,
    });
    expect(modalOf(modal.interaction)?.custom_id).toBe(
      customId('missions', 'verify', assignmentA!.id, 0),
    );
    const verified = await bot.run({
      kind: 'modal',
      name: customId('missions', 'verify', assignmentA!.id, 0),
      user: ops.user,
      modalText: { feedback: '' },
    });
    expect(verified.interaction.lastText()).toContain('SUBMISSION VERIFIED');
    expect(verified.interaction.lastText()).toContain('REVIEW QUEUE · 1 OF 1');
    const proofs = await bot.kit.db
      .select()
      .from(evidence)
      .where(eq(evidence.memberId, a.actor.memberId!));
    expect(proofs.map((row) => row.kind)).toEqual(['mission']);

    const [assignmentB] = (await assignmentsOf(mission.id)).filter(
      (row) => row.memberId === b.actor.memberId,
    );
    const empty = await bot.run({
      kind: 'modal',
      name: customId('missions', 'reject', assignmentB!.id, 0),
      user: ops.user,
      modalText: { feedback: '' },
    });
    expect(empty.interaction.lastText()).toContain('INVALID INPUT');
    const rejected = await bot.run({
      kind: 'modal',
      name: customId('missions', 'reject', assignmentB!.id, 0),
      user: ops.user,
      modalText: { feedback: 'The README does not run. Add setup steps.' },
    });
    expect(rejected.interaction.lastText()).toContain('SUBMISSION RETURNED');
    expect(rejected.interaction.lastText()).toContain('QUEUE CLEAR');
    const [rowB] = await bot.kit.db
      .select()
      .from(missionAssignments)
      .where(
        and(
          eq(missionAssignments.missionId, mission.id),
          eq(missionAssignments.memberId, b.actor.memberId!),
        ),
      );
    expect(rowB).toMatchObject({ status: 'rejected' });
  });

  it('BREAK: a reviewer never sees VERIFY on their own unit and cannot force it', async () => {
    const mission = await openMission(bot, core.actor);
    const assignment = await missions.selfAssignMission(bot.kit.as(ops.actor), {
      missionId: mission.id,
    });
    await missions.submitMission(bot.kit.as(ops.actor), {
      assignmentId: assignment.id,
      submission: 'My own work.',
    });
    const queue = await run(ops.user, 'review');
    expect(queue.interaction.lastText()).toContain('NOT YOURS TO REVIEW');
    expect(labels(queue.interaction)).not.toContain('VERIFY');
    const forced = await bot.run({
      kind: 'modal',
      name: customId('missions', 'verify', assignment.id, 0),
      user: ops.user,
      modalText: { feedback: 'Looks great to me.' },
    });
    expect(forced.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const [row] = await assignmentsOf(mission.id);
    expect(row?.status).toBe('submitted');
    const stale = await bot.run({
      kind: 'button',
      name: customId('missions', 'reject', 'not-a-uuid', 0),
      user: core.user,
    });
    expect(stale.interaction.lastText()).toContain('NOT FOUND');
  });

  it('archives only after confirmation', async () => {
    const mission = await openMission(bot, ops.actor);
    await missions.closeMission(bot.kit.as(ops.actor), { missionId: mission.id });
    const asked = await bot.run({
      kind: 'button',
      name: customId('missions', 'archive', mission.id),
      user: ops.user,
    });
    expect(asked.interaction.lastText()).toContain('ARCHIVE MISSION');
    expect((await missionRow(mission.id)).status).toBe('closed');
    const done = await bot.run({
      kind: 'button',
      name: customId('missions', 'archive_go', mission.id),
      user: ops.user,
    });
    expect(done.interaction.lastText()).toContain('MISSION ARCHIVED');
    expect((await missionRow(mission.id)).status).toBe('archived');
  });
});
