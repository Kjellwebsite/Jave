import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs, memberCapabilities, verifications } from '@jave/database';
import { type UserActor, verification } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import {
  buttonId,
  buttonLabels,
  modalInputIds,
  modalOf,
  payloadText,
  selectControl,
} from '../applications/testing/helpers';
import { createContribution, createProject } from './testing/fixtures';

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

/** Staff flows run several interactions and job drains each. */
const FLOW_TIMEOUT_MS = 60_000;

describe('verification — staff queue and decisions', { timeout: FLOW_TIMEOUT_MS }, () => {
  let bot: BotHarness;
  let subject: Person;

  async function requestProject(person: Person, title = 'Orbit tracker'): Promise<string> {
    const projectId = await createProject(bot.kit, person.actor.memberId!, title);
    const created = await verification.requestVerification(bot.kit.as(person.actor), {
      target: { type: 'project', projectId },
      evidence: [{ title: 'Repository', url: 'https://github.com/example/orbit' }],
    });
    return created.id;
  }

  async function status(id: string) {
    const [row] = await bot.kit.db.select().from(verifications).where(eq(verifications.id, id));
    return row!;
  }

  beforeEach(async () => {
    bot = await createBotHarness();
    subject = await bot.member({ roles: ['trial'], username: 'nova' });
  });
  afterEach(async () => {
    await bot.close();
  });

  it('queue → open → start review → approve with a note', async () => {
    const id = await requestProject(subject);
    const verifier = await bot.member({ roles: ['operations'], username: 'theo' });
    const queue = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: verifier.user,
      subcommand: 'queue',
    });
    const listed = queue.interaction.lastPayload()!;
    expect(listed.ephemeral).toBe(true);
    expect(queue.interaction.lastText()).toContain('VERIFICATION QUEUE');
    expect(queue.interaction.lastText()).toContain('VER-0001');
    expect(queue.interaction.lastText()).toContain('unassigned');
    expect(selectControl(listed).options).toEqual([id]);

    const opened = await bot.run({
      kind: 'select',
      name: selectControl(listed).customId!,
      user: verifier.user,
      values: [id],
    });
    const detail = opened.interaction.lastPayload()!;
    expect(opened.interaction.lastText()).toContain('VERIFICATION — STAFF VIEW');
    expect(opened.interaction.lastText()).toContain('https://github.com/example/orbit');
    expect(buttonLabels(detail)).toEqual([
      'START REVIEW',
      'APPROVE',
      'REJECT',
      'OPEN IN DASHBOARD',
    ]);

    const claimed = await bot.run({
      kind: 'button',
      name: buttonId(detail, 'Start review'),
      user: verifier.user,
    });
    expect(claimed.interaction.lastText()).toContain('IN REVIEW — VER-0001');
    expect((await status(id)).status).toBe('in_review');

    const again = await bot.run({
      kind: 'button',
      name: buttonId(detail, 'Start review'),
      user: verifier.user,
    });
    expect(again.interaction.lastText()).toContain('VER-0001 is IN REVIEW');

    const form = await bot.run({
      kind: 'button',
      name: buttonId(detail, 'Approve'),
      user: verifier.user,
    });
    const modal = modalOf(form.interaction);
    expect(modal.title).toBe('APPROVE VER-0001');
    expect(modalInputIds(modal)).toEqual(['note']);
    const approved = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: verifier.user,
      modalText: { note: 'Repository history shows sustained ownership.' },
    });
    expect(approved.interaction.lastText()).toContain('VERIFICATION APPROVED — VER-0001');
    expect((await status(id)).status).toBe('approved');

    const mine = await bot.run({
      kind: 'select',
      name: customId('verification', 'mine'),
      user: subject.user,
      values: [id],
    });
    const own = mine.interaction.lastText();
    expect(own).toContain('APPROVED');
    expect(own).toContain('Repository history shows sustained ownership.');
    expect(own).not.toContain('theo');
    // No verifier controls for the subject: only the link to their own record.
    expect(buttonLabels(mine.interaction.lastPayload())).toEqual(['OPEN IN DASHBOARD']);
  });

  it('skill approvals ask for the rank to grant; evaluators may grant another one', async () => {
    const created = await verification.requestVerification(bot.kit.as(subject.actor), {
      target: { type: 'skill', facetKey: 'mind.research', requestedRank: 'A' },
    });
    const evaluator = await bot.member({ roles: ['core'] });
    const form = await bot.run({
      kind: 'button',
      name: customId('verification', 'approve', created.id),
      user: evaluator.user,
    });
    const modal = modalOf(form.interaction);
    expect(modalInputIds(modal)).toEqual(['grantedRank', 'note']);
    expect(JSON.stringify(modal)).toContain('"default":true');
    const approved = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: evaluator.user,
      modalSelect: { grantedRank: ['B'] },
      modalText: { note: 'Replication is solid; the novel part is thinner than claimed.' },
    });
    expect(approved.interaction.lastText()).toContain('verified at B');
    const [capability] = await bot.kit.db
      .select()
      .from(memberCapabilities)
      .where(
        and(
          eq(memberCapabilities.memberId, subject.actor.memberId!),
          eq(memberCapabilities.facetKey, 'mind.research'),
        ),
      );
    expect(capability!.verifiedRank).toBe('B');

    const reject = await bot.run({
      kind: 'button',
      name: customId('verification', 'reject', created.id),
      user: evaluator.user,
    });
    expect(reject.interaction.lastText()).toContain('VER-0001 is APPROVED');
  });

  it('rejects with a note, and revokes an approval with a reason', async () => {
    const rejectedId = await requestProject(subject, 'First');
    const approvedId = await requestProject(subject, 'Second');
    const verifier = await bot.member({ roles: ['operations'] });
    const rejectForm = await bot.run({
      kind: 'button',
      name: customId('verification', 'reject', rejectedId),
      user: verifier.user,
    });
    expect(modalOf(rejectForm.interaction).title).toBe('REJECT VER-0001');
    const rejected = await bot.run({
      kind: 'modal',
      name: modalOf(rejectForm.interaction).custom_id,
      user: verifier.user,
      modalText: { note: 'The repository does not show your commits.' },
    });
    expect(rejected.interaction.lastText()).toContain('VERIFICATION REJECTED — VER-0001');
    expect((await status(rejectedId)).status).toBe('rejected');

    await verification.decideVerification(bot.kit.as(verifier.actor), {
      verificationId: approvedId,
      decision: 'approve',
      note: 'Verified against the release history.',
    });
    const detail = await bot.run({
      kind: 'button',
      name: customId('verification', 'open', approvedId),
      user: verifier.user,
    });
    expect(buttonLabels(detail.interaction.lastPayload())).toEqual(['REVOKE', 'OPEN IN DASHBOARD']);
    const revokeForm = await bot.run({
      kind: 'button',
      name: buttonId(detail.interaction.lastPayload(), 'Revoke'),
      user: verifier.user,
    });
    const modal = modalOf(revokeForm.interaction);
    expect(modalInputIds(modal)).toEqual(['reason']);
    const revoked = await bot.run({
      kind: 'modal',
      name: modal.custom_id,
      user: verifier.user,
      modalText: { reason: 'The release history was rewritten after approval.' },
    });
    expect(revoked.interaction.lastText()).toContain('VERIFICATION REVOKED — VER-0002');
    expect((await status(approvedId)).status).toBe('revoked');
  });

  it('pages through the queue and filters to unassigned work', async () => {
    const second = await bot.member({ roles: ['trial'] });
    const verifier = await bot.member({ roles: ['operations'] });
    for (let i = 0; i < 6; i++) {
      const contributionId = await createContribution(bot.kit, subject.actor.memberId!);
      await verification.requestVerification(bot.kit.as(subject.actor), {
        target: { type: 'contribution', contributionId },
      });
    }
    for (let i = 0; i < 5; i++) {
      const contributionId = await createContribution(bot.kit, second.actor.memberId!);
      await verification.requestVerification(bot.kit.as(second.actor), {
        target: { type: 'contribution', contributionId },
      });
    }
    const first = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: verifier.user,
      subcommand: 'queue',
    });
    const page = first.interaction.lastPayload()!;
    expect(selectControl(page).options).toHaveLength(10);
    expect(page.embeds![0]!.footer?.text).toBe('1–10 of 11');
    const next = await bot.run({
      kind: 'button',
      name: buttonId(page, 'Next'),
      user: verifier.user,
    });
    expect(next.interaction.responses[0]!.type).toBe('update');
    const nextPage = next.interaction.lastPayload()!;
    expect(selectControl(nextPage).options).toHaveLength(1);
    expect(buttonLabels(nextPage)).toEqual(['PREVIOUS']);

    const [oldest] = selectControl(page).options;
    await verification.startReview(bot.kit.as(verifier.actor), { verificationId: oldest! });
    const unassigned = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: verifier.user,
      subcommand: 'queue',
      options: { view: 'unassigned' },
    });
    expect(unassigned.interaction.lastPayload()!.embeds![0]!.footer?.text).toBe('1–10 of 10');
    const mine = await bot.run({
      kind: 'slash',
      name: 'verify',
      user: verifier.user,
      subcommand: 'queue',
      options: { view: 'mine' },
    });
    expect(selectControl(mine.interaction.lastPayload()).options).toEqual([oldest]);
  });

  it('the Verifications context menu shows a member’s record to verifiers', async () => {
    await requestProject(subject);
    const verifier = await bot.member({ roles: ['operations'] });
    const { interaction } = await bot.run({
      kind: 'user_context',
      name: 'Verifications',
      user: verifier.user,
      targetUser: subject.user,
    });
    expect(interaction.lastPayload()!.ephemeral).toBe(true);
    expect(interaction.lastText()).toContain('VERIFICATIONS — NOVA');
    expect(interaction.lastText()).toContain('VER-0001');
    const stranger = await bot.member({ roles: ['operations'] });
    const empty = await bot.run({
      kind: 'user_context',
      name: 'Verifications',
      user: verifier.user,
      targetUser: stranger.user,
    });
    expect(empty.interaction.lastText()).toContain('has no verifications on record');
  });

  describe('BREAK', () => {
    it('members pressing verifier controls are refused and audited', async () => {
      const id = await requestProject(subject);
      const member = await bot.member({ roles: ['verified'] });
      for (const action of ['claim', 'approve', 'reject', 'revoke']) {
        const { interaction } = await bot.run({
          kind: 'button',
          name: customId('verification', action, id),
          user: member.user,
        });
        expect(interaction.lastText(), action).toContain('NOT FOUND');
        expect(interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      }
      const forged = await bot.run({
        kind: 'modal',
        name: customId('verification', 'decide', 'approve', id),
        user: member.user,
        modalText: { note: 'Approving my friend.' },
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      for (const name of ['queue']) {
        const queue = await bot.run({
          kind: 'slash',
          name: 'verify',
          user: member.user,
          subcommand: name,
        });
        expect(queue.interaction.lastText()).toContain('ACCESS RESTRICTED');
      }
      const menu = await bot.run({
        kind: 'user_context',
        name: 'Verifications',
        user: member.user,
        targetUser: subject.user,
      });
      expect(menu.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'access.denied'));
      expect(denials.length).toBeGreaterThanOrEqual(5);
      expect((await status(id)).status).toBe('pending');
    });

    it('the subject cannot decide their own request, even as staff or through a forged form', async () => {
      const staffSubject = await bot.member({ roles: ['operations'] });
      const id = await requestProject(staffSubject);
      const detail = await bot.run({
        kind: 'button',
        name: customId('verification', 'open', id),
        user: staffSubject.user,
      });
      expect(buttonLabels(detail.interaction.lastPayload())).toEqual(['OPEN IN DASHBOARD']);
      expect(detail.interaction.lastText()).toContain('You cannot verify your own request.');
      const pressed = await bot.run({
        kind: 'button',
        name: customId('verification', 'approve', id),
        user: staffSubject.user,
      });
      expect(pressed.interaction.lastText()).toContain('You cannot verify your own request.');
      expect(pressed.interaction.responses.some((r) => r.type === 'modal')).toBe(false);
      const forged = await bot.run({
        kind: 'modal',
        name: customId('verification', 'decide', 'approve', id),
        user: staffSubject.user,
        modalText: { note: 'Looks right to me.' },
      });
      expect(forged.interaction.lastText()).toContain('You cannot verify your own request.');
      const blocked = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'verification.self_decision_blocked'));
      expect(blocked).toHaveLength(1);
      expect((await status(id)).status).toBe('pending');
    });

    it('two-person rule, assignment and type capabilities gate the controls', async () => {
      const opener = await bot.member({ roles: ['operations'] });
      const opened = await verification.requestVerification(bot.kit.as(opener.actor), {
        subjectMemberId: subject.actor.memberId!,
        target: { type: 'identity' },
      });
      const own = await bot.run({
        kind: 'button',
        name: customId('verification', 'approve', opened.id),
        user: opener.user,
      });
      expect(own.interaction.lastText()).toContain('You opened this request for someone else.');

      const holder = await bot.member({ roles: ['operations'] });
      await verification.startReview(bot.kit.as(holder.actor), { verificationId: opened.id });
      const third = await bot.member({ roles: ['operations'] });
      const elsewhere = await bot.run({
        kind: 'button',
        name: customId('verification', 'reject', opened.id),
        user: third.user,
      });
      expect(elsewhere.interaction.lastText()).toContain('assigned to another verifier');

      const skill = await verification.requestVerification(bot.kit.as(subject.actor), {
        target: { type: 'skill', facetKey: 'create.technical', requestedRank: 'B' },
      });
      const noRanks = await bot.run({
        kind: 'button',
        name: customId('verification', 'approve', skill.id),
        user: third.user,
      });
      expect(noRanks.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const detail = await bot.run({
        kind: 'button',
        name: customId('verification', 'open', skill.id),
        user: third.user,
      });
      expect(payloadText(detail.interaction.lastPayload())).toContain(
        'needs a capability your roles do not include',
      );
    });

    it('forged and malformed custom ids fail safely', async () => {
      const verifier = await bot.member({ roles: ['core'] });
      const cases: [string, 'button' | 'modal', string][] = [
        [customId('verification', 'approve', 'not-a-uuid'), 'button', 'INVALID INPUT'],
        [
          customId('verification', 'claim', '00000000-0000-4000-8000-000000000000'),
          'button',
          'NOT FOUND',
        ],
        [customId('verification', 'page', '-1', 'open'), 'button', 'Invalid page.'],
        [customId('verification', 'nonsense'), 'button', 'EXPIRED'],
        [
          customId('verification', 'decide', 'promote', '00000000-0000-4000-8000-000000000000'),
          'modal',
          'Unknown decision.',
        ],
        [customId('verification', 'wat'), 'modal', 'EXPIRED'],
      ];
      for (const [name, kind, expected] of cases) {
        const { interaction, outcome } = await bot.run({ kind, name, user: verifier.user });
        expect(interaction.lastText(), name).toContain(expected);
        expect(outcome.errorId, name).toBeNull();
      }
      const id = await requestProject(subject);
      const rankOnProject = await bot.run({
        kind: 'modal',
        name: customId('verification', 'decide', 'approve', id),
        user: verifier.user,
        modalSelect: { grantedRank: ['S'] },
        modalText: { note: 'Trying to smuggle a rank.' },
      });
      expect(rankOnProject.interaction.lastText()).toContain('A granted rank applies only');
      const shortNote = await bot.run({
        kind: 'modal',
        name: customId('verification', 'decide', 'reject', id),
        user: verifier.user,
        modalText: { note: 'no' },
      });
      expect(shortNote.interaction.lastText()).toContain('INVALID INPUT');
      expect((await status(id)).status).toBe('pending');
    });
  });
});
