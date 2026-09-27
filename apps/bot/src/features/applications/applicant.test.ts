import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applications as applicationsTable, memberRoles } from '@jave/database';
import { activeRoles, applications, updateSettings, type UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import {
  buttonId,
  buttonLabels,
  controls,
  modalInputIds,
  modalOf,
  selectControl,
} from './testing/helpers';

const ANSWERS = {
  motivation: 'I want to ship flight software with people who hold a higher bar than I do.',
  experience: 'Two years on a student cubesat team; I own the attitude-control loop.',
  projects: 'Attitude control stack, flown twice.',
  portfolioUrl: 'https://example.org/portfolio',
  evidenceLinks: 'https://github.com/example/adcs\nhttps://example.org/flight-log',
};

describe('applications — applicant flow', () => {
  let bot: BotHarness;
  let user: InteractionUser;
  let actor: UserActor;
  let memberId: string;

  beforeEach(async () => {
    bot = await createBotHarness();
    const created = await bot.member({ username: 'nova' });
    user = created.user;
    actor = created.actor;
    memberId = created.actor.memberId!;
  });
  afterEach(async () => {
    await bot.close();
  });

  async function openPanel() {
    const { interaction } = await bot.run({
      kind: 'slash',
      name: 'apply',
      user,
      subcommand: 'start',
    });
    return interaction.lastPayload()!;
  }

  async function startDraft() {
    const panel = await openPanel();
    const { interaction } = await bot.run({
      kind: 'button',
      name: buttonId(panel, 'Start application'),
      user,
    });
    return interaction;
  }

  async function saveAnswers(values: Record<string, string>) {
    return bot.run({
      kind: 'modal',
      name: customId('applications', 'save', 1),
      user,
      modalText: values,
    });
  }

  it('walks from an empty panel to a submitted application', async () => {
    const intro = await openPanel();
    expect(intro.ephemeral).toBe(true);
    expect(intro.embeds![0]!.title).toBe('APPLY TO JAVELIN');
    expect(buttonLabels(intro)).toEqual(['START APPLICATION']);

    const started = await startDraft();
    const draft = started.lastPayload()!;
    expect(started.responses[0]!.type).toBe('update');
    expect(draft.embeds![0]!.title).toBe('APP-0001 — DRAFT');
    expect(started.lastText()).toContain('Choose a primary domain.');
    expect(buttonLabels(draft)).toEqual([
      'EDIT ANSWERS',
      'EDIT REFERENCES',
      'SUBMIT',
      'DISCARD DRAFT',
    ]);
    expect(selectControl(draft).options).toEqual(['mind', 'create', 'body', 'life', 'bio']);

    const edit = await bot.run({ kind: 'button', name: buttonId(draft, 'Edit answers'), user });
    const modal = modalOf(edit.interaction);
    expect(modal.custom_id).toBe('applications:save:1');
    expect(modal.title).toBe('APPLICATION — ANSWERS (1/2)');
    expect(modalInputIds(modal)).toEqual([
      'motivation',
      'experience',
      'projects',
      'portfolioUrl',
      'evidenceLinks',
    ]);
    const referencesModal = modalOf(
      (await bot.run({ kind: 'button', name: buttonId(draft, 'Edit references'), user }))
        .interaction,
    );
    expect(modalInputIds(referencesModal)).toEqual(['references', 'referralCode']);

    const saved = await saveAnswers(ANSWERS);
    expect(saved.interaction.lastText()).toContain('DRAFT SAVED');
    expect(saved.interaction.lastPayload()!.ephemeral).toBe(true);

    const domain = await bot.run({
      kind: 'select',
      name: selectControl(draft).customId!,
      user,
      values: ['create'],
    });
    expect(domain.interaction.lastText()).toContain('Every requirement is met.');

    const refs = await bot.run({
      kind: 'modal',
      name: customId('applications', 'save', 2),
      user,
      modalText: { references: 'Ada, mentor — ada@example.org', referralCode: '' },
    });
    expect(refs.interaction.lastText()).toContain('Provided — visible to staff only.');

    const submitted = await bot.run({
      kind: 'button',
      name: buttonId(domain.interaction.lastPayload(), 'Submit'),
      user,
    });
    expect(submitted.interaction.lastText()).toContain('APPLICATION SUBMITTED — APP-0001');
    expect(await activeRoles(bot.kit.system, memberId)).toContain('applicant');
    const [row] = await bot.kit.db.select().from(applicationsTable);
    expect(row).toMatchObject({
      status: 'submitted',
      domainKey: 'create',
      evidenceLinks: ['https://github.com/example/adcs', 'https://example.org/flight-log'],
      references: 'Ada, mentor — ada@example.org',
    });

    const status = await bot.run({ kind: 'slash', name: 'apply', user, subcommand: 'status' });
    const text = status.interaction.lastText();
    expect(text).toContain('APP-0001 — SUBMITTED');
    expect(text).toContain('DRAFT');
    expect(text).toContain('TIMELINE');
    const inFlight = await openPanel();
    expect(buttonLabels(inFlight)).toEqual(['REFRESH', 'WITHDRAW']);
  });

  it('lists every missing requirement instead of submitting', async () => {
    await startDraft();
    await saveAnswers({ motivation: 'Too short.' });
    const { interaction } = await bot.run({
      kind: 'button',
      name: customId('applications', 'submit'),
      user,
    });
    const text = interaction.lastText();
    expect(text).toContain('NOT READY TO SUBMIT');
    for (const message of [
      'Choose a primary domain.',
      'Motivation needs at least 30 characters.',
      'Experience needs at least 30 characters.',
      'Add projects, a portfolio URL or at least one evidence link.',
    ])
      expect(text).toContain(message);
    const [row] = await bot.kit.db.select().from(applicationsTable);
    expect(row!.status).toBe('draft');
  });

  it('withdrawal states its cost, then withdraws and returns APPLICANT to MEMBER', async () => {
    await startDraft();
    await saveAnswers(ANSWERS);
    await bot.run({
      kind: 'select',
      name: customId('applications', 'domain'),
      user,
      values: ['mind'],
    });
    await bot.run({ kind: 'button', name: customId('applications', 'submit'), user });

    const confirm = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw'),
      user,
    });
    expect(confirm.interaction.lastText()).toContain('WITHDRAW APP-0001?');
    expect(confirm.interaction.lastText()).toContain('You can submit again from');
    const [before] = await bot.kit.db.select().from(applicationsTable);
    expect(before!.status).toBe('submitted');

    const done = await bot.run({
      kind: 'button',
      name: buttonId(confirm.interaction.lastPayload(), 'Withdraw application'),
      user,
    });
    expect(done.interaction.lastText()).toContain('APPLICATION WITHDRAWN — APP-0001');
    const roles = await activeRoles(bot.kit.system, memberId);
    expect(roles).not.toContain('applicant');
    expect(roles).toContain('member');
    const panel = await openPanel();
    expect(panel.embeds![0]!.title).toBe('APP-0001 — WITHDRAWN');
    expect(buttonLabels(panel)).toEqual(['START NEW APPLICATION']);
  });

  it('discarding a draft costs nothing', async () => {
    await startDraft();
    const confirm = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw'),
      user,
    });
    expect(confirm.interaction.lastText()).toContain('DISCARD APP-0001?');
    expect(confirm.interaction.lastText()).toContain('You can start again at any time.');
    const [row] = await bot.kit.db.select().from(applicationsTable);
    const discard = buttonId(confirm.interaction.lastPayload(), 'Discard draft');
    expect(discard).toBe(customId('applications', 'withdraw_confirm', row!.id, 'draft'));
    const done = await bot.run({ kind: 'button', name: discard, user });
    expect(done.interaction.lastText()).toContain('DRAFT DISCARDED — APP-0001');
  });

  it('BREAK: a confirmation that went stale restates the cost instead of withdrawing', async () => {
    await startDraft();
    await saveAnswers(ANSWERS);
    await bot.run({
      kind: 'select',
      name: customId('applications', 'domain'),
      user,
      values: ['mind'],
    });
    await bot.run({ kind: 'button', name: customId('applications', 'submit'), user });
    const confirm = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw'),
      user,
    });
    const staleButton = buttonId(confirm.interaction.lastPayload(), 'Withdraw application');
    // A reviewer claims it between the confirmation and the click: the cost rises.
    const [row] = await bot.kit.db.select().from(applicationsTable);
    const reviewer = await bot.member({ roles: ['operations'] });
    await applications.startReview(bot.kit.as(reviewer.actor), { applicationId: row!.id });

    const stale = await bot.run({ kind: 'button', name: staleButton, user });
    expect(stale.interaction.responses[0]!.type).toBe('update');
    const text = stale.interaction.lastText();
    expect(text).toContain('WITHDRAW APP-0001?');
    expect(text).toContain(
      'changed since you confirmed: it is now in review. Nothing was withdrawn.',
    );
    const [still] = await bot.kit.db.select().from(applicationsTable);
    expect(still!.status).toBe('review');

    // The restated confirmation carries the new state and withdraws when clicked.
    const fresh = buttonId(stale.interaction.lastPayload(), 'Withdraw application');
    expect(fresh).toBe(customId('applications', 'withdraw_confirm', row!.id, 'review'));
    const done = await bot.run({ kind: 'button', name: fresh, user });
    expect(done.interaction.lastText()).toContain('APPLICATION WITHDRAWN — APP-0001');
  });

  it('BREAK: a stale "discard draft" cannot withdraw a draft submitted elsewhere', async () => {
    await startDraft();
    await saveAnswers(ANSWERS);
    await bot.run({
      kind: 'select',
      name: customId('applications', 'domain'),
      user,
      values: ['life'],
    });
    const confirm = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw'),
      user,
    });
    const discard = buttonId(confirm.interaction.lastPayload(), 'Discard draft');
    // Submitted from the dashboard while the Discord confirmation stayed open.
    await applications.submitApplication(bot.kit.as(actor));
    const stale = await bot.run({ kind: 'button', name: discard, user });
    expect(stale.interaction.lastText()).toContain('it is now submitted. Nothing was withdrawn.');
    expect(stale.interaction.lastText()).toContain('WITHDRAW APP-0001?');
    expect(stale.interaction.lastText()).toContain('You can submit again from');
    const [row] = await bot.kit.db.select().from(applicationsTable);
    expect(row!.status).toBe('submitted');

    // A confirm without the state it was stated for never withdraws either.
    const bare = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw_confirm'),
      user,
    });
    expect(bare.interaction.lastText()).toContain('Confirm again');
    expect((await bot.kit.db.select().from(applicationsTable))[0]!.status).toBe('submitted');
  });

  it('BREAK: an answer too long for a Discord input is never cut short by a prefill', async () => {
    await startDraft();
    // Written before the stored-length cap: 10 links of 560 characters once encoded.
    const links = Array.from(
      { length: 10 },
      (_, i) => `https://example.org/${i}${'%D0%BF'.repeat(90)}`,
    );
    await bot.kit.db.update(applicationsTable).set({ evidenceLinks: links });
    const refused = await bot.run({
      kind: 'button',
      name: customId('applications', 'edit', 1),
      user,
    });
    expect(refused.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
    const text = refused.interaction.lastText();
    expect(text).toContain('EDIT IN THE DASHBOARD');
    expect(text).toContain('Evidence links is longer than a Discord form holds (4000 characters)');
    const link = controls(refused.interaction.lastPayload()).find((c) => c.type === 'link');
    expect(link?.url).toBe('https://jave.test/me/application');
    const [row] = await bot.kit.db.select().from(applicationsTable);
    expect(row!.evidenceLinks).toEqual(links);
    // The other page still opens.
    const references = await bot.run({
      kind: 'button',
      name: customId('applications', 'edit', 2),
      user,
    });
    expect(modalOf(references.interaction).custom_id).toBe('applications:save:2');
  });

  it('shows eligibility and closed applications calmly', async () => {
    const verified = await bot.member({ roles: ['verified'] });
    const inside = await bot.run({
      kind: 'slash',
      name: 'apply',
      user: verified.user,
      subcommand: 'start',
    });
    expect(inside.interaction.lastText()).toContain('ALREADY INSIDE JAVELIN');
    expect(buttonLabels(inside.interaction.lastPayload())).toEqual([]);

    await updateSettings(bot.kit.system, 'applications', { open: false });
    const closed = await openPanel();
    expect(closed.embeds![0]!.title).toBe('APPLICATIONS CLOSED');
    expect(buttonLabels(closed)).toEqual([]);
    const forced = await bot.run({ kind: 'button', name: customId('applications', 'start'), user });
    expect(forced.interaction.lastText()).toContain('DISABLED');
  });

  it('BREAK: editing without a draft, or after submitting, is refused', async () => {
    const noDraft = await bot.run({
      kind: 'button',
      name: customId('applications', 'edit', 1),
      user,
    });
    expect(noDraft.interaction.lastText()).toContain('There is no draft to edit.');

    await startDraft();
    await saveAnswers(ANSWERS);
    await bot.run({
      kind: 'select',
      name: customId('applications', 'domain'),
      user,
      values: ['life'],
    });
    await bot.run({ kind: 'button', name: customId('applications', 'submit'), user });
    const late = await saveAnswers({ motivation: 'Rewritten after submission, which must fail.' });
    expect(late.interaction.lastText()).toContain('NOT AVAILABLE RIGHT NOW');
    const [row] = await bot.kit.db.select().from(applicationsTable);
    expect(row!.motivation).toBe(ANSWERS.motivation);
  });

  it('BREAK: forged pages, domains and hostile input are refused or neutralized', async () => {
    await startDraft();
    const page = await bot.run({
      kind: 'button',
      name: customId('applications', 'edit', 9),
      user,
    });
    expect(page.interaction.lastText()).toContain('INVALID INPUT');
    const domain = await bot.run({
      kind: 'select',
      name: customId('applications', 'domain'),
      user,
      values: ['godmode'],
    });
    expect(domain.interaction.lastText()).toContain('Unknown domain.');
    const script = await saveAnswers({ portfolioUrl: 'javascript:alert(1)' });
    expect(script.interaction.lastText()).toContain('INVALID INPUT');
    // Refusals name the answer by its form label, never the input key.
    expect(script.interaction.lastText()).toContain('Nothing was saved.');
    expect(script.interaction.lastText()).toContain(
      'Portfolio URL: must be an http(s) URL without credentials',
    );
    const nul = await saveAnswers({ motivation: 'null\u0000byte' });
    expect(nul.interaction.lastText()).toContain('INVALID INPUT');
    const oversized = await saveAnswers({ motivation: 'x'.repeat(2001) });
    expect(oversized.interaction.lastText()).toContain('INVALID INPUT');

    const injected = await saveAnswers({
      motivation: '@everyone <@123456789012345678> **bold** [link](https://evil.example)',
    });
    const text = injected.interaction.lastText();
    expect(text).not.toContain('@everyone');
    expect(text).not.toMatch(/<@\d{17,20}>/);
    expect(text).toContain('\\*\\*bold\\*\\*');
  });

  it('BREAK: another member cannot touch my draft through my controls', async () => {
    await startDraft();
    await saveAnswers(ANSWERS);
    const intruder = await bot.member({ username: 'intruder' });
    // The same custom ids act on the clicking user's own (absent) application.
    const edit = await bot.run({
      kind: 'button',
      name: customId('applications', 'edit', 1),
      user: intruder.user,
    });
    expect(edit.interaction.lastText()).toContain('There is no draft to edit.');
    const [victim] = await bot.kit.db.select().from(applicationsTable);
    const withdraw = await bot.run({
      kind: 'button',
      name: customId('applications', 'withdraw_confirm', victim!.id, 'draft'),
      user: intruder.user,
    });
    expect(withdraw.interaction.lastText()).toContain('NOT FOUND');
    const [row] = await bot.kit.db
      .select()
      .from(applicationsTable)
      .where(eq(applicationsTable.status, 'draft'));
    expect(row!.motivation).toBe(ANSWERS.motivation);
    expect(
      (await bot.kit.db.select().from(memberRoles)).filter((r) => r.role === 'applicant'),
    ).toHaveLength(0);
    expect(applications.isOpenStatus(row!.status)).toBe(true);
  });
});
