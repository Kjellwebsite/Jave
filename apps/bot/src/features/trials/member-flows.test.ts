import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { APIEmbed } from 'discord.js';
import { trialParticipants } from '@jave/database';
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
  type Person,
  people,
  recruitingTrial,
  STATEMENT,
  SUBMISSION,
  pace,
  SUITE,
} from './test-fixtures';

type Components = { components: { custom_id?: string; label?: string; disabled?: boolean }[] }[];

function modalOf(interaction: FakeInteraction) {
  const response = interaction.responses.find((r) => r.type === 'modal');
  return response && response.type === 'modal' ? response.modal : null;
}

function customIds(interaction: FakeInteraction): string[] {
  const payload = interaction.lastPayload();
  return ((payload?.components ?? []) as Components).flatMap((r) =>
    r.components.map((c) => c.custom_id ?? ''),
  );
}

async function participantStatus(bot: BotHarness, trialId: string, person: Person) {
  const [row] = await bot.kit.db
    .select({ status: trialParticipants.status })
    .from(trialParticipants)
    .where(
      and(
        eq(trialParticipants.trialId, trialId),
        eq(trialParticipants.memberId, person.actor.memberId!),
      ),
    );
  return row?.status ?? null;
}

describe('trials: member flows', SUITE, () => {
  let bot: BotHarness;
  beforeEach(async () => {
    bot = pace(await createBotHarness());
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await bot.close();
  }, HOOK_TIMEOUT_MS);

  it('/trial list: recruiting trials with APPLY for eligible members; drafts never listed', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [member] = await people(bot, 1, ['trial']);
    const recruiting = await recruitingTrial(bot, manager!, []);
    await draftTrial(bot, manager!, { title: 'Hidden Draft' });

    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'list',
      user: member!.user,
    });
    const payload = interaction.lastPayload()!;
    expect(payload.ephemeral).toBe(true);
    const text = everything(interaction);
    expect(text).toContain('NIGHT BUILD');
    expect(text).not.toContain('Hidden Draft');
    expect(customIds(interaction)).toContain(`trials:apply:${recruiting}`);
    expect(customIds(interaction)).toContain('trials:pick:view');

    // A MEMBER (not TRIAL/VERIFIED) sees the list but no APPLY button.
    const [outsider] = await people(bot, 1, ['member']);
    const other = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'list',
      user: outsider!.user,
    });
    expect(customIds(other.interaction)).not.toContain(`trials:apply:${recruiting}`);
  });

  it('APPLY from the recruitment card: statement modal, recorded, then refused as a duplicate', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const [applicant] = await people(bot, 1, ['trial']);
    const trialId = await recruitingTrial(bot, manager!, []);
    await bot.drain();
    const card = bot.gateway
      .callsTo('sendMessage')
      .find((call) => call.args[0] === ANNOUNCEMENTS_CHANNEL)!;
    const applyId = (card.args[1] as { components: Components }).components[0]!.components[0]!
      .custom_id!;
    expect(applyId).toBe(`trials:apply:${trialId}`);

    const press = await bot.run({ kind: 'button', name: applyId, user: applicant!.user });
    const modal = modalOf(press.interaction);
    expect(modal?.custom_id).toBe(`trials:apply:${trialId}`);
    expect(modal?.title).toContain('APPLY — TRIAL-');

    const submitted = await bot.run({
      kind: 'modal',
      name: applyId,
      user: applicant!.user,
      modalText: { statement: STATEMENT },
    });
    expect(submitted.interaction.lastText()).toContain('APPLICATION RECORDED');
    expect(submitted.interaction.lastPayload()!.ephemeral).toBe(true);
    expect(await participantStatus(bot, trialId, applicant!)).toBe('applied');

    const again = await bot.run({ kind: 'button', name: applyId, user: applicant!.user });
    expect(modalOf(again.interaction)).toBeNull();
    expect(again.interaction.lastText()).toContain('already hold a place');
  });

  it('BREAK: ineligible members, drafts, closed recruitment and forged ids never reach the modal', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [outsider] = await people(bot, 1, ['member']);
    const [applicant] = await people(bot, 1, ['trial']);
    const trialId = await recruitingTrial(bot, manager!, []);

    const ineligible = await bot.run({
      kind: 'button',
      name: customId('trials', 'apply', trialId),
      user: outsider!.user,
    });
    expect(modalOf(ineligible.interaction)).toBeNull();
    expect(ineligible.interaction.lastText()).toContain('open to TRIAL and VERIFIED members');

    // Bypassing the pre-check with a forged modal submission: core refuses.
    const forgedModal = await bot.run({
      kind: 'modal',
      name: customId('trials', 'apply', trialId),
      user: outsider!.user,
      modalText: { statement: STATEMENT },
    });
    expect(forgedModal.interaction.lastText()).toContain('ACCESS RESTRICTED');
    expect(await participantStatus(bot, trialId, outsider!)).toBeNull();

    const draft = await draftTrial(bot, manager!, { title: 'Secret Draft' });
    const toDraft = await bot.run({
      kind: 'button',
      name: customId('trials', 'apply', draft),
      user: applicant!.user,
    });
    expect(toDraft.interaction.lastText()).toContain('NOT FOUND');
    expect(everything(toDraft.interaction)).not.toContain('Secret Draft');

    for (const name of ['trials:apply:not-a-uuid', 'trials:apply', 'trials:nonsense:x:y']) {
      const forged = await bot.run({ kind: 'button', name, user: applicant!.user });
      expect(forged.interaction.lastText()).toContain('EXPIRED');
    }

    const closedTrial = await recruitingTrial(bot, manager!, [], {
      recruitmentClosesAt: new Date(bot.kit.clock.now().getTime() + 30 * MINUTE),
    });
    bot.kit.clock.advance(31 * MINUTE);
    const late = await bot.run({
      kind: 'button',
      name: customId('trials', 'apply', closedTrial),
      user: applicant!.user,
    });
    expect(late.interaction.lastText()).toContain('Recruitment for this trial is closed');
  });

  it('withdraw: confirmation first, then the place is released; nothing to withdraw afterwards', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [applicant] = await people(bot, 1, ['trial']);
    const trialId = await recruitingTrial(bot, manager!, [applicant!]);

    const offer = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'withdraw',
      user: applicant!.user,
    });
    expect(customIds(offer.interaction)).toContain(`trials:withdraw:${trialId}`);
    const ask = await bot.run({
      kind: 'button',
      name: customId('trials', 'withdraw', trialId),
      user: applicant!.user,
    });
    expect(ask.interaction.lastText()).toContain('CONFIRM');
    expect(await participantStatus(bot, trialId, applicant!)).toBe('applied');
    const confirm = await bot.run({
      kind: 'button',
      name: customId('trials', 'withdraw-yes', trialId),
      user: applicant!.user,
    });
    expect(confirm.interaction.lastText()).toContain('WITHDRAWN');
    expect(await participantStatus(bot, trialId, applicant!)).toBe('withdrawn');

    const nothing = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'withdraw',
      user: applicant!.user,
    });
    expect(nothing.interaction.lastText()).toContain('NOTHING TO WITHDRAW FROM');

    // BREAK: someone else pressing a withdrawal control acts only on themselves.
    const [stranger] = await people(bot, 1, ['trial']);
    const forged = await bot.run({
      kind: 'button',
      name: customId('trials', 'withdraw-yes', trialId),
      user: stranger!.user,
    });
    expect(forged.interaction.lastText()).toMatch(/NOT FOUND|CONFLICT|NOT AVAILABLE/);
    expect(await participantStatus(bot, trialId, stranger!)).toBeNull();
  });

  it('submit: versions, prefilled resubmission, LATE inside the window, closed after it', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await activeTrial(bot, manager!, players);
    const [player] = players;

    const offer = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'submit',
      user: player!.user,
    });
    expect(customIds(offer.interaction)).toContain(`trials:submit:${trialId}`);

    const open = await bot.run({
      kind: 'button',
      name: customId('trials', 'submit', trialId),
      user: player!.user,
    });
    expect(JSON.stringify(modalOf(open.interaction))).toContain('Becomes version 1.');
    const first = await bot.run({
      kind: 'modal',
      name: customId('trials', 'submit', trialId),
      user: player!.user,
      modalText: { summary: SUBMISSION, links: 'https://jvln.test/demo\nhttps://jvln.test/repo' },
    });
    expect(first.interaction.lastText()).toContain('SUBMISSION RECEIVED — V1');
    expect(first.interaction.lastText()).not.toContain('LATE');

    const reopen = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'submit',
      user: player!.user,
      options: { trial: trialId },
    });
    const prefilled = JSON.stringify(modalOf(reopen.interaction));
    expect(prefilled).toContain('Becomes version 2.');
    expect(prefilled).toContain(SUBMISSION);
    expect(prefilled).toContain('https://jvln.test/repo');

    bot.kit.clock.advance(121 * MINUTE);
    const late = await bot.run({
      kind: 'modal',
      name: customId('trials', 'submit', trialId),
      user: players[1]!.user,
      modalText: { summary: `${SUBMISSION} Final fixes.`, links: '' },
    });
    expect(late.interaction.lastText()).toContain('SUBMISSION RECEIVED — V2');
    expect(late.interaction.lastText()).toContain('LATE');

    bot.kit.clock.advance(20 * MINUTE);
    const closed = await bot.run({
      kind: 'button',
      name: customId('trials', 'submit', trialId),
      user: player!.user,
    });
    expect(modalOf(closed.interaction)).toBeNull();
    expect(closed.interaction.lastText()).toContain('submission window is closed');
  });

  it('BREAK: non-competitors cannot submit; unsafe links are refused', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const [outsider] = await people(bot, 1, ['verified']);
    const { trialId } = await activeTrial(bot, manager!, players);

    const button = await bot.run({
      kind: 'button',
      name: customId('trials', 'submit', trialId),
      user: outsider!.user,
    });
    expect(modalOf(button.interaction)).toBeNull();
    expect(button.interaction.lastText()).toContain('Only members of a team');
    const forged = await bot.run({
      kind: 'modal',
      name: customId('trials', 'submit', trialId),
      user: outsider!.user,
      modalText: { summary: SUBMISSION, links: '' },
    });
    expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');

    const unsafe = await bot.run({
      kind: 'modal',
      name: customId('trials', 'submit', trialId),
      user: players[0]!.user,
      modalText: { summary: SUBMISSION, links: 'javascript:alert(1)' },
    });
    expect(unsafe.interaction.lastText()).toContain('INVALID INPUT');
  });

  it('/trial status and /team: teams, private channel, countdown, brief excerpt — privately', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await assignedTrial(bot, manager!, players);
    await bot.drain();

    const before = await bot.run({ kind: 'slash', name: 'team', user: players[0]!.user });
    const waiting = before.interaction.lastText();
    expect(waiting).toContain('UNIT ALPHA');
    expect(waiting).toContain('Starts when staff give the signal');
    expect(waiting).not.toContain('MISSION');

    await trials.startTrial(as(bot, manager!), { trialId });
    await bot.drain();
    const team = await bot.run({ kind: 'slash', name: 'team', user: players[0]!.user });
    const text = team.interaction.lastText();
    expect(team.interaction.lastPayload()!.ephemeral).toBe(true);
    expect(text).toMatch(/Channel <#\d+>/);
    expect(text).toMatch(/Deadline <t:\d+:F> · <t:\d+:R>/);
    expect(text).toContain('Ship a working tool');
    expect(customIds(team.interaction)).toContain(`trials:submit:${trialId}`);

    const status = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'status',
      user: players[1]!.user,
    });
    const statusText = status.interaction.lastText();
    expect(statusText).toContain('SELECTED · LIVE');
    expect(statusText).toMatch(/<t:\d+:R>/);

    const [outsider] = await people(bot, 1, ['trial']);
    const none = await bot.run({ kind: 'slash', name: 'team', user: outsider!.user });
    expect(none.interaction.lastText()).toContain('NO ACTIVE TEAM');
  });

  it('/trial view: typed references resolve; sealed brief stays sealed for non-competitors', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const [watcher] = await people(bot, 1, ['verified']);
    const { trialId } = await activeTrial(bot, manager!, players);
    const view = await trials.getTrialForParticipant(as(bot, players[0]!), { trialId });

    for (const typed of [view.ref, `#${view.number}`, String(view.number), 'night build']) {
      const run = await bot.run({
        kind: 'slash',
        name: 'trial',
        subcommand: 'view',
        user: players[0]!.user,
        options: { trial: typed },
      });
      expect(everything(run.interaction), typed).toContain('Ship a working tool');
    }

    const outside = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'view',
      user: watcher!.user,
      options: { trial: trialId },
    });
    expect(outside.interaction.lastText()).toContain('NIGHT BUILD');
    expect(everything(outside.interaction)).not.toContain('Ship a working tool');

    const missing = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'view',
      user: watcher!.user,
      options: { trial: 'TRIAL-9999' },
    });
    expect(missing.interaction.lastText()).toContain('NOT FOUND');
  });

  it('Refresh updates the member’s own view in place; the brief is never re-sent', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await activeTrial(bot, manager!, players);
    await bot.drain();

    const opened = await bot.run({
      kind: 'slash',
      name: 'trial',
      subcommand: 'view',
      user: players[0]!.user,
      options: { trial: trialId },
    });
    // Live state and controls first; the brief below it.
    const [live, ...reference] = opened.interaction.responses.filter((r) => 'payload' in r);
    expect(live!.type).toBe('editReply');
    const liveIds = JSON.stringify(live);
    expect(liveIds).toContain(`trials:submit:${trialId}`);
    expect(liveIds).toContain(`trials:open:${trialId}:1`);
    expect(liveIds).not.toContain('Ship a working tool');
    expect(JSON.stringify(reference)).toContain('Ship a working tool');

    for (let press = 0; press < 3; press++) {
      const refresh = await bot.run({
        kind: 'button',
        name: customId('trials', 'open', trialId, '1'),
        user: players[0]!.user,
      });
      expect(refresh.interaction.responses.map((r) => r.type)).toEqual(['update']);
      expect(refresh.interaction.lastText()).toContain('NIGHT BUILD');
      expect(customIds(refresh.interaction)).toContain(`trials:open:${trialId}:1`);
    }

    // From /team, the view replaces the team panel and brings the brief once.
    const team = await bot.run({ kind: 'slash', name: 'team', user: players[1]!.user });
    expect(customIds(team.interaction)).toContain(`trials:open:${trialId}:0`);
    const fromTeam = await bot.run({
      kind: 'button',
      name: customId('trials', 'open', trialId, '0'),
      user: players[1]!.user,
    });
    const types = fromTeam.interaction.responses.map((r) => r.type);
    expect(types[0]).toBe('update');
    expect(types.slice(1).every((type) => type === 'followUp')).toBe(true);
    expect(JSON.stringify(fromTeam.interaction.responses.slice(1))).toContain(
      'Ship a working tool',
    );
  });

  it('BREAK: public cards and team-channel posts never carry the in-place control', async () => {
    await configureDiscord(bot);
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    const { trialId } = await activeTrial(bot, manager!, players);
    await bot.drain();
    const posts = JSON.stringify(bot.gateway.callsTo('sendMessage').map((call) => call.args[1]));
    expect(posts).toContain(`trials:view:${trialId}`);
    expect(posts).not.toContain('trials:open:');

    // A forged or stale in-place press is re-authorized like any other.
    const [outsider] = await people(bot, 1, ['member']);
    const draftId = await draftTrial(bot, manager!, { title: 'Hidden Draft' });
    const forged = await bot.run({
      kind: 'button',
      name: customId('trials', 'open', draftId, '1'),
      user: outsider!.user,
    });
    expect(forged.interaction.responses.map((r) => r.type)).toEqual(['reply']);
    expect(forged.interaction.lastText()).toContain('NOT FOUND');
    const garbage = await bot.run({
      kind: 'button',
      name: customId('trials', 'open', 'not-a-trial', '1'),
      user: outsider!.user,
    });
    expect(garbage.interaction.lastText()).toContain('EXPIRED');
  });

  it('autocomplete offers only what the member may see', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const [member] = await people(bot, 1, ['trial']);
    await recruitingTrial(bot, manager!, []);
    await draftTrial(bot, manager!, { title: 'Staff Only Draft' });
    const run = await bot.run({
      kind: 'autocomplete',
      name: 'trial',
      user: member!.user,
      focused: { name: 'trial', value: '' },
    });
    const response = run.interaction.responses.find((r) => r.type === 'autocomplete');
    const names = response?.type === 'autocomplete' ? response.choices.map((c) => c.name) : [];
    expect(names.some((name) => name.includes('Night Build'))).toBe(true);
    expect(names.some((name) => name.includes('Staff Only Draft'))).toBe(false);
  });

  it('Trial Record context menu: yourself yes; another member only for staff', async () => {
    const [manager] = await people(bot, 1, ['operations']);
    const players = await people(bot, 2);
    await activeTrial(bot, manager!, players);
    const self = await bot.run({
      kind: 'user_context',
      name: 'Trial Record',
      user: players[0]!.user,
      targetUser: players[0]!.user,
    });
    expect(self.interaction.lastText()).toContain('TRIAL RECORD');
    expect(self.interaction.lastText()).toContain('1 TRIAL');

    const peer = await bot.run({
      kind: 'user_context',
      name: 'Trial Record',
      user: players[0]!.user,
      targetUser: players[1]!.user,
    });
    expect(peer.interaction.lastText()).toContain('ACCESS RESTRICTED');

    const staff = await bot.run({
      kind: 'user_context',
      name: 'Trial Record',
      user: manager!.user,
      targetUser: players[1]!.user,
    });
    const embed = staff.interaction.lastPayload()!.embeds![0] as APIEmbed;
    expect(embed.author?.name).toBe('TRIAL RECORD');
    expect(staff.interaction.lastPayload()!.ephemeral).toBe(true);
  });
});
