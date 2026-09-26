import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { trials as trialsTable } from '@jave/database';
import { MINUTE, trials } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { FakeInteraction } from '../../testing/fake-interaction';
import { type BotHarness, createBotHarness } from '../../testing/harness';
import {
  activeTrial,
  ANNOUNCEMENTS_CHANNEL,
  as,
  assignedTrial,
  configureDiscord,
  draftTrial,
  everything,
  HOOK_TIMEOUT_MS,
  people,
  recruitingTrial,
  STATEMENT,
  SUBMISSION,
  pace,
  SUITE,
} from './test-fixtures';

type Components = { components: { custom_id?: string; label?: string; url?: string }[] }[];

function controls(interaction: FakeInteraction): { id: string; label: string }[] {
  const payload = interaction.lastPayload();
  return ((payload?.components ?? []) as Components).flatMap((r) =>
    r.components.map((c) => ({ id: c.custom_id ?? c.url ?? '', label: c.label ?? '' })),
  );
}

function labels(interaction: FakeInteraction): string[] {
  return controls(interaction).map((c) => c.label);
}

function modalOf(interaction: FakeInteraction) {
  const response = interaction.responses.find((r) => r.type === 'modal');
  return response && response.type === 'modal' ? response.modal : null;
}

async function statusOf(bot: BotHarness, trialId: string) {
  const [row] = await bot.kit.db
    .select({ status: trialsTable.status })
    .from(trialsTable)
    .where(eq(trialsTable.id, trialId));
  return row!.status;
}

const FIVE_CRITERIA = [
  { key: 'shipped', label: 'Working product', weight: 3 },
  { key: 'value', label: 'User value', weight: 2 },
  { key: 'quality', label: 'Quality', weight: 1 },
  { key: 'speed', label: 'Speed', weight: 1 },
  { key: 'clarity', label: 'Clarity', weight: 1 },
];

describe('trials: staff control panel', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = pace(await createBotHarness());
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT_MS);

  it('draft → recruiting → selected → assigned → live, each step confirmed', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 4);
    const trialId = await draftTrial(bot, manager!);

    const picker = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'manage',
      user: manager!.user,
    });
    expect(controls(picker.interaction)[0]!.id).toBe('trials:pick:manage');
    const panel = await bot.run({
      kind: 'select',
      name: 'trials:pick:manage',
      values: [trialId],
      user: manager!.user,
    });
    expect(panel.interaction.responses[0]!.type).toBe('update');
    expect(panel.interaction.lastText()).toContain('TRIAL CONTROL');
    expect(labels(panel.interaction)).toEqual(
      expect.arrayContaining(['OPEN RECRUITMENT', 'CANCEL TRIAL', 'REFRESH', 'DASHBOARD']),
    );
    const dashboard = controls(panel.interaction).find((c) => c.label === 'DASHBOARD')!;
    expect(dashboard.id).toBe(`https://jave.test/trials/${trialId}`);

    const ask = await bot.run({
      kind: 'button',
      name: customId('trials', 'ask', 'open', trialId),
      user: manager!.user,
    });
    expect(ask.interaction.lastText()).toContain('OPEN RECRUITMENT — TRIAL-');
    expect(await statusOf(bot, trialId)).toBe('draft');
    const open = await bot.run({
      kind: 'button',
      name: customId('trials', 'run', 'open', trialId),
      user: manager!.user,
    });
    expect(open.interaction.lastText()).toContain('RECRUITMENT OPEN');
    expect(await statusOf(bot, trialId)).toBe('recruiting');
    await bot.drain();
    expect(bot.gateway.callsTo('sendMessage').some((c) => c.args[0] === ANNOUNCEMENTS_CHANNEL)).toBe(
      true,
    );
    expect(labels(open.interaction)).toEqual(
      expect.arrayContaining(['SELECT — RANDOM', 'SELECT — MANUAL', 'ASSIGN TEAMS']),
    );

    for (const player of players)
      await trials.applyToTrial(as(bot, player), { trialId, statement: STATEMENT });

    const randomModal = await bot.run({
      kind: 'button',
      name: customId('trials', 'sel-random', trialId),
      user: manager!.user,
    });
    expect(modalOf(randomModal.interaction)?.custom_id).toBe(`trials:sel-random:${trialId}`);
    const drawn = await bot.run({
      kind: 'modal',
      name: customId('trials', 'sel-random', trialId),
      user: manager!.user,
      modalText: { count: '3', seed: 'draw-1' },
    });
    expect(drawn.interaction.lastText()).toContain('3 drawn from 4 eligible applicants');
    expect(drawn.interaction.lastText()).toContain('draw-1');

    const manual = await bot.run({
      kind: 'button',
      name: customId('trials', 'sel-manual', trialId),
      user: manager!.user,
    });
    const select = (manual.interaction.lastPayload()!.components as Components)[0]!.components[0]!;
    expect(select.custom_id).toBe(`trials:sel-pick:${trialId}`);
    const picked = await bot.run({
      kind: 'select',
      name: customId('trials', 'sel-pick', trialId),
      values: players.map((p) => p.actor.memberId!),
      user: manager!.user,
    });
    expect(picked.interaction.lastText()).toContain('4 selected');

    const assignModal = await bot.run({
      kind: 'button',
      name: customId('trials', 'assign', trialId),
      user: manager!.user,
    });
    expect(JSON.stringify(modalOf(assignModal.interaction))).toContain('BALANCED');
    const assigned = await bot.run({
      kind: 'modal',
      name: customId('trials', 'assign', trialId),
      user: manager!.user,
      modalText: { teamSize: '2', seed: 'teams-1' },
      modalSelect: { strategy: ['random'] },
    });
    const notice = assigned.interaction.lastText();
    expect(notice).toContain('TEAMS ASSIGNED · RANDOM');
    expect(notice).toContain('2 TEAMS OF 2');
    expect(notice).toContain('teams-1');
    expect(notice).toContain('No scheduled start');
    expect(labels(assigned.interaction)).toContain('START');
    expect(await statusOf(bot, trialId)).toBe('teams_assigned');

    await bot.run({
      kind: 'button',
      name: customId('trials', 'ask', 'start', trialId),
      user: manager!.user,
    });
    const start = await bot.run({
      kind: 'button',
      name: customId('trials', 'run', 'start', trialId),
      user: manager!.user,
    });
    expect(start.interaction.lastText()).toContain('TRIAL LIVE');
    expect(await statusOf(bot, trialId)).toBe('active');
    expect(labels(start.interaction)).toEqual(
      expect.arrayContaining(['CLOSE SUBMISSIONS', 'EXTEND DEADLINE']),
    );

    const extend = await bot.run({
      kind: 'modal',
      name: customId('trials', 'extend', trialId),
      user: manager!.user,
      modalText: { minutes: '30', reason: 'Venue power cut for twenty minutes.' },
    });
    expect(extend.interaction.lastText()).toContain('DEADLINE EXTENDED');
  });

  it('a scheduled start that already passed is called out, with START on the panel', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const now = bot.kit.clock.now().getTime();
    const trialId = await recruitingTrial(bot, manager!, players, {
      recruitmentClosesAt: new Date(now + 30 * MINUTE),
      scheduledStartAt: new Date(now + 60 * MINUTE),
    });
    await trials.selectParticipants(as(bot, manager!), {
      trialId,
      mode: 'manual',
      memberIds: players.map((p) => p.actor.memberId!),
    });
    bot.kit.clock.advance(61 * MINUTE);
    const assigned = await bot.run({
      kind: 'modal',
      name: customId('trials', 'assign', trialId),
      user: manager!.user,
      modalText: { teamSize: '', seed: '' },
      modalSelect: { strategy: ['balanced'] },
    });
    const text = assigned.interaction.lastText();
    expect(text).toContain('has passed');
    expect(text).toContain('Start it by hand now');
    expect(labels(assigned.interaction)).toContain('START');
  });

  it('close, quick evaluation (≤ 4 criteria), publish with the incomplete warning', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [evaluator] = await people(bot, 1, ['operations']);
    const players = await people(bot, 4);
    const { trialId, assignment } = await activeTrial(bot, manager!, players);
    const submitter = players.find((p) =>
      assignment.teams[0]!.memberIds.includes(p.actor.memberId!),
    )!;
    await trials.submit(as(bot, submitter), { trialId, summary: SUBMISSION, links: [] });
    const secondTeam = players.find((p) =>
      assignment.teams[1]!.memberIds.includes(p.actor.memberId!),
    )!;
    await trials.submit(as(bot, secondTeam), { trialId, summary: SUBMISSION, links: [] });

    await bot.run({
      kind: 'button',
      name: customId('trials', 'ask', 'close', trialId),
      user: manager!.user,
    });
    const closed = await bot.run({
      kind: 'button',
      name: customId('trials', 'run', 'close', trialId),
      user: manager!.user,
    });
    expect(closed.interaction.lastText()).toContain('2 of 2 teams submitted');
    expect(labels(closed.interaction)).toEqual(
      expect.arrayContaining(['EVALUATE', 'PUBLISH RESULTS']),
    );

    const offer = await bot.run({
      kind: 'button',
      name: customId('trials', 'eval', trialId),
      user: evaluator!.user,
    });
    expect(offer.interaction.lastText()).toContain('CHOOSE A TEAM');
    const chosen = await bot.run({
      kind: 'select',
      name: customId('trials', 'eval-team', trialId),
      values: [assignment.teams[0]!.id],
      user: evaluator!.user,
    });
    const modal = modalOf(chosen.interaction)!;
    expect(modal.custom_id).toBe(`trials:eval:${trialId}:${assignment.teams[0]!.id}`);
    expect(JSON.stringify(modal)).toContain('weight 75%');

    const badScore = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: evaluator!.user,
      modalText: { 'score-0': '11', 'score-1': '7' },
    });
    expect(badScore.interaction.lastText()).toContain('INVALID INPUT');
    const fraction = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: evaluator!.user,
      modalText: { 'score-0': '7.5', 'score-1': '7' },
    });
    expect(fraction.interaction.lastText()).toContain('whole number');
    const scored = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: evaluator!.user,
      modalText: { 'score-0': '8', 'score-1': '6', notes: 'Shipped, thin on users.' },
    });
    expect(scored.interaction.lastText()).toContain('EVALUATION RECORDED');
    expect(scored.interaction.lastText()).toContain('7.50 / 10');

    // Re-opening pre-fills the evaluator's earlier scores.
    const reopen = await bot.run({
      kind: 'select',
      name: customId('trials', 'eval-team', trialId),
      values: [assignment.teams[0]!.id],
      user: evaluator!.user,
    });
    expect(JSON.stringify(modalOf(reopen.interaction))).toContain('Shipped, thin on users.');

    const ask = await bot.run({
      kind: 'button',
      name: customId('trials', 'ask', 'publish', trialId),
      user: manager!.user,
    });
    expect(ask.interaction.lastText()).toContain('have no evaluation');
    const publishId = controls(ask.interaction)[0]!.id;
    expect(publishId).toBe(`trials:run:publish-incomplete:${trialId}`);
    const published = await bot.run({ kind: 'button', name: publishId, user: manager!.user });
    expect(published.interaction.lastText()).toContain('RESULTS PUBLISHED');
    expect(published.interaction.lastText()).toContain('Rank consequences are applied separately');
    expect(await statusOf(bot, trialId)).toBe('completed');
  });

  it('rubrics over four criteria are scored in the dashboard', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await activeTrial(bot, manager!, players, { rubric: FIVE_CRITERIA });
    await trials.submit(as(bot, players[0]!), { trialId, summary: SUBMISSION, links: [] });
    await trials.closeSubmissions(as(bot, manager!), { trialId });
    const offer = await bot.run({
      kind: 'button',
      name: customId('trials', 'eval', trialId),
      user: manager!.user,
    });
    expect(offer.interaction.lastText()).toContain('SCORE IN THE DASHBOARD');
    expect(controls(offer.interaction)[0]!.id).toBe(
      `https://jave.test/trials/${trialId}?tab=evaluation`,
    );
    const forced = await bot.run({
      kind: 'modal',
      name: customId('trials', 'eval', trialId, (await trials.getTrialForStaff(as(bot, manager!), { trialId })).teams[0]!.id),
      user: manager!.user,
      modalText: { 'score-0': '5' },
    });
    expect(forced.interaction.lastText()).toContain('scored in the dashboard');
  });

  it('cancel: confirmation, then a reason modal; stakeholders are told', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    const ask = await bot.run({
      kind: 'button',
      name: customId('trials', 'ask', 'cancel', trialId),
      user: manager!.user,
    });
    expect(ask.interaction.lastText()).toContain('This cannot be undone');
    const confirmId = controls(ask.interaction)[0]!.id;
    const modal = await bot.run({ kind: 'button', name: confirmId, user: manager!.user });
    expect(modalOf(modal.interaction)?.custom_id).toBe(`trials:cancel:${trialId}`);
    const tooShort = await bot.run({
      kind: 'modal',
      name: `trials:cancel:${trialId}`,
      user: manager!.user,
      modalText: { reason: 'x' },
    });
    expect(tooShort.interaction.lastText()).toContain('INVALID INPUT');
    expect(await statusOf(bot, trialId)).toBe('teams_assigned');
    const cancelled = await bot.run({
      kind: 'modal',
      name: `trials:cancel:${trialId}`,
      user: manager!.user,
      modalText: { reason: 'The venue is gone for the weekend.' },
    });
    expect(cancelled.interaction.lastText()).toContain('TRIAL CANCELLED');
    expect(await statusOf(bot, trialId)).toBe('cancelled');
    expect(labels(cancelled.interaction)).not.toContain('CANCEL TRIAL');
  });

  it('BREAK: members pressing staff controls change nothing and learn nothing', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    const member = players[0]!;
    const attempts = [
      customId('trials', 'panel', trialId),
      customId('trials', 'ask', 'start', trialId),
      customId('trials', 'run', 'start', trialId),
      customId('trials', 'run', 'cancel', trialId),
      customId('trials', 'run', 'publish', trialId),
      customId('trials', 'sel-manual', trialId),
      customId('trials', 'sel-random', trialId),
      customId('trials', 'assign', trialId),
      customId('trials', 'eval', trialId),
    ];
    for (const name of attempts) {
      const { interaction } = await bot.run({ kind: 'button', name, user: member.user });
      expect(modalOf(interaction), name).toBeNull();
      expect(interaction.lastText(), name).toContain('ACCESS RESTRICTED');
      expect(everything(interaction), name).not.toContain('Ship a working tool');
    }
    const modals: { name: string; modalText: Record<string, string> }[] = [
      { name: customId('trials', 'sel-random', trialId), modalText: { count: '1' } },
      { name: customId('trials', 'cancel', trialId), modalText: { reason: 'I want out now.' } },
      {
        name: customId('trials', 'extend', trialId),
        modalText: { minutes: '60', reason: 'More time.' },
      },
    ];
    for (const forged of modals) {
      const { interaction } = await bot.run({ kind: 'modal', ...forged, user: member.user });
      expect(interaction.lastText(), forged.name).toContain('ACCESS RESTRICTED');
    }
    const manage = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'manage',
      user: member.user,
    });
    expect(manage.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(await statusOf(bot, trialId)).toBe('teams_assigned');
  });

  it('BREAK: staff with a stake cannot operate the trial; stale and forged controls fail safely', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [staffPlayer] = await people(bot, 1, ['operations']);
    const players = await people(bot, 1);
    const { trialId } = await activeTrial(bot, manager!, [...players, staffPlayer!]);

    const conflicted = await bot.run({
      kind: 'button',
      name: customId('trials', 'panel', trialId),
      user: staffPlayer!.user,
    });
    expect(conflicted.interaction.lastText()).toContain('You are taking part in this trial');
    const start = await bot.run({
      kind: 'button',
      name: customId('trials', 'run', 'close', trialId),
      user: staffPlayer!.user,
    });
    expect(start.interaction.lastText()).toContain('You are taking part in this trial');
    expect(await statusOf(bot, trialId)).toBe('active');

    // A stale START on an already-live trial.
    const stale = await bot.run({
      kind: 'button',
      name: customId('trials', 'run', 'start', trialId),
      user: manager!.user,
    });
    expect(stale.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
    for (const name of [
      customId('trials', 'run', 'detonate', trialId),
      customId('trials', 'ask', 'open', 'nope'),
      'trials:run',
    ]) {
      const forged = await bot.run({ kind: 'button', name, user: manager!.user });
      expect(forged.interaction.lastText(), name).toContain('EXPIRED');
    }
  });
});
