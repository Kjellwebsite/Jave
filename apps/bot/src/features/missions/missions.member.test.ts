import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { missionAssignments, missions as missionsTable } from '@jave/database';
import { missions } from '@jave/core';
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

const RATE_LIMIT_SPACING_MS = 1_000;

type Member = Awaited<ReturnType<BotHarness['member']>>;

describe('missions — member flows', () => {
  let bot: BotHarness;
  let ops: Member;
  let member: Member;

  beforeEach(async () => {
    bot = await createBotHarness();
    ops = await bot.member({ roles: ['operations'], username: 'ops' });
    member = await bot.member({ roles: ['verified'], username: 'mara' });
  });
  afterEach(async () => {
    await bot.close();
  });

  async function assignmentOf(missionId: string, memberId: string) {
    const [row] = await bot.kit.db
      .select()
      .from(missionAssignments)
      .where(
        and(eq(missionAssignments.missionId, missionId), eq(missionAssignments.memberId, memberId)),
      );
    return row ?? null;
  }

  function run(user: InteractionUser, subcommand: string, options = {}) {
    return bot.run({ kind: 'slash', name: 'mission', subcommand, user, options });
  }

  /** Space interactions out so a long adversarial sequence stays under the per-user rate limit. */
  function pace() {
    bot.kit.clock.advance(RATE_LIMIT_SPACING_MS);
  }

  it('lists open missions with ACCEPT buttons and a type filter', async () => {
    const build = await openMission(bot, ops.actor, { maxAssignees: 3 });
    const research = await openMission(bot, ops.actor, {
      title: 'Literature sweep',
      type: 'research',
    });
    await missions.createMission(bot.kit.as(ops.actor), {
      title: 'Secret draft',
      brief: BRIEF,
      type: 'build',
    });
    const { interaction } = await run(member.user, 'list');
    const payload = interaction.lastPayload()!;
    expect(payload.ephemeral).toBe(true);
    const text = interaction.lastText();
    expect(text).toContain('OPEN MISSIONS');
    expect(text).toContain('M-0001 — Prototype sprint');
    expect(text).toContain('3 of 3 left');
    expect(text).toContain('M-0002 — Literature sweep');
    expect(text).not.toContain('Secret draft');
    expect(customIds(interaction)).toEqual(
      expect.arrayContaining([
        customId('missions', 'filter'),
        missions.missionAcceptCustomId(build.id),
        missions.missionAcceptCustomId(research.id),
      ]),
    );

    const filtered = await bot.run({
      kind: 'select',
      name: customId('missions', 'filter'),
      user: member.user,
      values: ['research'],
    });
    expect(filtered.interaction.responses[0]?.type).toBe('update');
    expect(filtered.interaction.lastText()).toContain('Literature sweep');
    expect(filtered.interaction.lastText()).not.toContain('Prototype sprint');

    const forged = await bot.run({
      kind: 'select',
      name: customId('missions', 'filter'),
      user: member.user,
      values: ['draft'],
    });
    // Anything that is not a type means every type, never an error or a draft.
    expect(forged.interaction.lastText()).toContain('Prototype sprint');
    expect(forged.interaction.lastText()).not.toContain('Secret draft');
  });

  it('ACCEPT takes the mission; SUBMIT sends work with evidence through the modal', async () => {
    const mission = await openMission(bot, ops.actor, { durationHours: 48 });
    const accepted = await bot.run({
      kind: 'button',
      name: missions.missionAcceptCustomId(mission.id),
      user: member.user,
    });
    expect(accepted.interaction.lastText()).toContain('MISSION ACCEPTED');
    expect(accepted.interaction.lastText()).toContain('IN PROGRESS');
    expect(accepted.interaction.lastText()).toMatch(/Due <t:\d+:f>/);
    expect(labels(accepted.interaction)).toEqual(['SUBMIT', 'ABANDON']);
    expect((await assignmentOf(mission.id, member.actor.memberId!))?.status).toBe('accepted');

    const opened = await run(member.user, 'submit');
    const modal = modalOf(opened.interaction)!;
    expect(modal.custom_id).toBe(customId('missions', 'submit', mission.id));

    const partial = await bot.run({
      kind: 'modal',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
      modalText: { submission: 'Built it.', evidence_title: 'Repository', evidence_url: '' },
    });
    expect(partial.interaction.lastText()).toContain('INVALID INPUT');

    const scheme = await bot.run({
      kind: 'modal',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
      modalText: {
        submission: 'Built it.',
        evidence_title: 'Repository',
        evidence_url: 'javascript:alert(1)',
      },
    });
    expect(scheme.interaction.lastText()).toContain('INVALID INPUT');

    const sent = await bot.run({
      kind: 'modal',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
      modalText: {
        submission: 'Built the prototype. Notes in the README.',
        evidence_title: 'Repository',
        evidence_url: EVIDENCE_URL,
      },
      sourceMessage: { ephemeral: true },
    });
    // Submitted from the private detail view: the view refreshes in place.
    expect(sent.interaction.responses.map((r) => r.type)).toEqual(['update']);
    expect(sent.interaction.lastText()).toContain('SUBMISSION SENT');
    expect(sent.interaction.lastText()).toContain('Attempt 1 of 3');
    expect(sent.interaction.lastText()).toContain('AWAITING REVIEW');
    // Submitted work never expires: the assignment no longer shows a due date.
    expect(sent.interaction.lastText()).not.toMatch(/Due <t:\d+:f> \(/);
    const row = await assignmentOf(mission.id, member.actor.memberId!);
    expect(row).toMatchObject({ status: 'submitted', submissionEvidenceUrl: EVIDENCE_URL });

    const again = await bot.run({
      kind: 'button',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
    });
    expect(again.interaction.lastText()).toContain('awaiting review');
    expect(modalOf(again.interaction)).toBeNull();
  });

  it('a team submission moves every teammate to review', async () => {
    const mission = await openMission(bot, ops.actor, { title: 'Relay build', type: 'team' });
    const mate = await bot.member({ roles: ['verified'], username: 'jun' });
    await missions.assignMission(bot.kit.as(ops.actor), {
      missionId: mission.id,
      memberIds: [member.actor.memberId!, mate.actor.memberId!],
      teamKey: 'alpha',
    });
    const view = await run(member.user, 'view', { mission: mission.id });
    expect(view.interaction.lastText()).toContain('Teams formed by staff');
    expect(view.interaction.lastText()).toContain('Team `alpha`');
    expect(labels(view.interaction)).toEqual(['ACCEPT', 'ABANDON']);

    await run(member.user, 'accept', { mission: mission.id });
    const opened = await bot.run({
      kind: 'button',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
    });
    expect(JSON.stringify(modalOf(opened.interaction))).toContain('Team alpha');
    const sent = await bot.run({
      kind: 'modal',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
      modalText: { submission: 'Relay shipped by both of us.' },
    });
    expect(sent.interaction.lastText()).toContain('Your team moves to review with you.');
    expect((await assignmentOf(mission.id, mate.actor.memberId!))?.status).toBe('submitted');
  });

  it('/mission mine lists own work and switches scope with the select', async () => {
    const mission = await openMission(bot, ops.actor);
    await run(member.user, 'accept', { mission: mission.id });
    const mine = await run(member.user, 'mine');
    expect(mine.interaction.lastText()).toContain('YOUR MISSIONS · ACTIVE');
    expect(mine.interaction.lastText()).toContain('M-0001 — Prototype sprint');
    const completed = await bot.run({
      kind: 'select',
      name: customId('missions', 'mine'),
      user: member.user,
      values: ['completed'],
    });
    expect(completed.interaction.lastText()).toContain('No verified missions yet.');
  });

  it('ABANDON asks first; afterwards the member cannot take it again alone', async () => {
    const mission = await openMission(bot, ops.actor);
    await run(member.user, 'accept', { mission: mission.id });
    const asked = await run(member.user, 'abandon', { mission: mission.id });
    expect(asked.interaction.lastText()).toContain('ABANDON MISSION');
    expect(customIds(asked.interaction)).toEqual([
      customId('missions', 'abandon_confirm', mission.id),
      customId('missions', 'dismiss'),
    ]);
    const kept = await bot.run({
      kind: 'button',
      name: customId('missions', 'dismiss'),
      user: member.user,
    });
    expect(kept.interaction.lastText()).toContain('NO CHANGE');
    expect((await assignmentOf(mission.id, member.actor.memberId!))?.status).toBe('accepted');

    const done = await bot.run({
      kind: 'button',
      name: customId('missions', 'abandon_confirm', mission.id),
      user: member.user,
    });
    expect(done.interaction.responses[0]?.type).toBe('update');
    expect(done.interaction.lastText()).toContain('MISSION ABANDONED');
    const retake = await bot.run({
      kind: 'button',
      name: missions.missionAcceptCustomId(mission.id),
      user: member.user,
    });
    expect(retake.interaction.lastText()).toMatch(/NOT AVAILABLE RIGHT NOW|CONFLICT/);
  });

  it('autocomplete offers only what the member can act on', async () => {
    const open = await openMission(bot, ops.actor);
    await missions.createMission(bot.kit.as(ops.actor), {
      title: 'Secret draft',
      brief: BRIEF,
      type: 'build',
    });
    const view = await bot.run({
      kind: 'autocomplete',
      name: 'mission',
      subcommand: 'view',
      user: member.user,
      focused: { name: 'mission', value: '' },
    });
    const choices = view.interaction.responses[0];
    expect(choices?.type === 'autocomplete' && choices.choices.map((c) => c.value)).toEqual([
      open.id,
    ]);
    const publish = await bot.run({
      kind: 'autocomplete',
      name: 'mission',
      subcommand: 'publish',
      user: member.user,
      focused: { name: 'mission', value: '' },
    });
    const none = publish.interaction.responses[0];
    expect(none?.type === 'autocomplete' && none.choices).toEqual([]);
  });

  it('BREAK: drafts, forged ids and other members’ work stay out of reach', async () => {
    const draft = await missions.createMission(bot.kit.as(ops.actor), {
      title: 'Secret draft',
      brief: BRIEF,
      type: 'build',
    });
    const hidden = await run(member.user, 'view', { mission: draft.id });
    expect(hidden.interaction.lastText()).toContain('NOT FOUND');
    const takeDraft = await bot.run({
      kind: 'button',
      name: missions.missionAcceptCustomId(draft.id),
      user: member.user,
    });
    expect(takeDraft.interaction.lastText()).toContain('NOT FOUND');

    const forged = await bot.run({
      kind: 'button',
      name: 'missions:accept:not-a-uuid',
      user: member.user,
    });
    expect(forged.interaction.lastText()).toContain('NOT FOUND');
    const typed = await run(member.user, 'view', { mission: "1'; drop table missions; --" });
    expect(typed.interaction.lastText()).toContain('INVALID INPUT');
    const unknown = await bot.run({ kind: 'button', name: 'missions:escalate', user: member.user });
    expect(unknown.interaction.lastText()).toContain('EXPIRED');

    const mission = await openMission(bot, ops.actor);
    const owner = await bot.member({ roles: ['verified'] });
    await run(owner.user, 'accept', { mission: mission.id });
    // The intruder holds no assignment: a submission for the owner's mission is NOT FOUND.
    const intrusion = await bot.run({
      kind: 'modal',
      name: customId('missions', 'submit', mission.id),
      user: member.user,
      modalText: { submission: 'Taking credit.' },
    });
    expect(intrusion.interaction.lastText()).toContain('NOT FOUND');
    const abandonOther = await bot.run({
      kind: 'button',
      name: customId('missions', 'abandon_confirm', mission.id),
      user: member.user,
    });
    expect(abandonOther.interaction.lastText()).toContain('NOT FOUND');
    expect((await assignmentOf(mission.id, owner.actor.memberId!))?.status).toBe('accepted');
    const [stored] = await bot.kit.db
      .select()
      .from(missionsTable)
      .where(eq(missionsTable.id, draft.id));
    expect(stored?.status).toBe('draft');
  });

  it('BREAK: members pressing staff controls or forging staff modals change nothing', async () => {
    const mission = await openMission(bot, ops.actor);
    for (const action of ['publish', 'archive', 'edit', 'settings', 'assign', 'assign_opts']) {
      pace();
      const pressed = await bot.run({
        kind: 'button',
        name: customId('missions', action, mission.id),
        user: member.user,
      });
      expect(pressed.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(modalOf(pressed.interaction)).toBeNull();
    }
    for (const action of ['close', 'publish_go', 'archive_go', 'toggle_evidence']) {
      pace();
      const pressed = await bot.run({
        kind: 'button',
        name: customId('missions', action, mission.id, 1),
        user: member.user,
      });
      expect(pressed.interaction.lastText()).toContain('ACCESS RESTRICTED');
    }
    pace();
    const picked = await bot.run({
      kind: 'select',
      name: customId('missions', 'assign_pick', mission.id, '-', '-'),
      user: member.user,
      values: [member.user.id],
    });
    expect(picked.interaction.lastText()).toContain('ACCESS RESTRICTED');
    pace();
    const created = await bot.run({
      kind: 'modal',
      name: customId('missions', 'create'),
      user: member.user,
      modalText: { title: 'Free achievements', brief: BRIEF },
      modalSelect: { type: ['build'] },
    });
    expect(created.interaction.lastText()).toContain('ACCESS RESTRICTED');
    for (const [action, fields] of [
      ['assign_opts', { team: 'alpha', hours: '24' }],
      ['edit', { title: 'Taken over', brief: BRIEF, hours: '', deadline: '', slots: '' }],
    ] as const) {
      pace();
      const forged = await bot.run({
        kind: 'modal',
        name: customId('missions', action, mission.id),
        user: member.user,
        modalText: fields,
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(forged.interaction.lastPayload()?.components ?? []).toEqual([]);
    }
    pace();
    const review = await run(member.user, 'review');
    expect(review.interaction.lastText()).toContain('ACCESS RESTRICTED');
    pace();
    const create = await run(member.user, 'create');
    expect(modalOf(create.interaction)).toBeNull();
    expect(create.interaction.lastText()).toContain('ACCESS RESTRICTED');
    const [stored] = await bot.kit.db
      .select()
      .from(missionsTable)
      .where(eq(missionsTable.id, mission.id));
    expect(stored?.status).toBe('open');
    expect(stored?.evidenceRequired).toBe(false);
    expect(stored?.title).toBe(mission.title);
    expect(await bot.kit.db.select().from(missionsTable)).toHaveLength(1);
  });

  it('BREAK: a press carrying a list or staff id never rewrites a public card', async () => {
    const mission = await openMission(bot, ops.actor);
    const publicCard = { ephemeral: false } as const;
    const filter = await bot.run({
      kind: 'select',
      name: customId('missions', 'filter'),
      user: member.user,
      values: ['build'],
      sourceMessage: publicCard,
    });
    expect(filter.interaction.responses.map((r) => r.type)).toEqual(['reply']);
    expect(filter.interaction.lastPayload()?.ephemeral).toBe(true);
    expect(filter.interaction.lastText()).toContain('OPEN MISSIONS');

    pace();
    // Staff pressing a forged CLOSE on the public card: the mission closes, the card is not edited
    // in place (the refresh job re-renders it from state); the result arrives privately.
    const closed = await bot.run({
      kind: 'button',
      name: customId('missions', 'close', mission.id),
      user: ops.user,
      sourceMessage: publicCard,
    });
    expect(closed.interaction.responses.map((r) => r.type)).toEqual(['reply']);
    expect(closed.interaction.lastPayload()?.ephemeral).toBe(true);
    expect(closed.interaction.lastText()).toContain('MISSION CLOSED');

    pace();
    const page = await bot.run({
      kind: 'button',
      name: customId('achievements', 'page', member.actor.memberId!, 1),
      user: member.user,
      sourceMessage: publicCard,
    });
    expect(page.interaction.responses.map((r) => r.type)).toEqual(['reply']);
    expect(page.interaction.lastPayload()?.ephemeral).toBe(true);
  });
});
