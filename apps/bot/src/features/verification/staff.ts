import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  authorize,
  can,
  ForbiddenError,
  InvalidStateError,
  loadCatalog,
  ValidationError,
  verification,
} from '@jave/core';
import type { HandlerContext, ModalPayload } from '../../interactions/types';
import { success } from '../../ui/components';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { ACTIONS, type Decision, parseDecision, verificationId } from './ids';
import { type QueueScope, QUEUE_SCOPES, renderDetail, renderQueue, targetLine } from './views';

type Detail = verification.VerificationDetail;
type Status = verification.VerificationStatus;
type Control = verification.VerificationControl;

export const QUEUE_PAGE_SIZE = 10;
const OPEN: readonly Status[] = verification.OPEN_STATUSES;
const OPTION_TEXT_CHARS = 100;
/** Discord caps a modal label's description at 100 characters. */
const LABEL_DESCRIPTION_CHARS = 100;

export const DECISION_FIELDS = { note: 'note', grantedRank: 'grantedRank' } as const;
export const REVOKE_FIELDS = { reason: 'reason' } as const;

export function parseScope(value: string | null | undefined): QueueScope {
  return QUEUE_SCOPES.find((scope) => scope === value) ?? 'open';
}

function queueQuery(scope: QueueScope, offset: number): verification.ListVerificationsInput {
  const page = { limit: QUEUE_PAGE_SIZE, offset };
  switch (scope) {
    case 'open':
      return { ...page, status: [...OPEN], sort: 'oldest' };
    case 'mine':
      return { ...page, status: [...OPEN], assignedToMe: true, sort: 'oldest' };
    case 'unassigned':
      return { ...page, status: [...OPEN], unassigned: true, sort: 'oldest' };
    case 'approved':
      return { ...page, status: 'approved', sort: 'newest' };
  }
}

/** A queue page. Verifiers only: members asking get ACCESS RESTRICTED (audited). */
export async function queuePayload(h: HandlerContext, scope: QueueScope, offset: number) {
  await authorize(h.ctx, 'canVerifyMembers', { type: 'verification' });
  const page = await verification.listVerifications(h.ctx, queueQuery(scope, offset));
  return renderQueue(page.items, page.total, scope, offset, QUEUE_PAGE_SIZE);
}

/** One verification, privately: the subject's own view or the verifier's view. */
export async function showDetail(h: HandlerContext, id: string | undefined): Promise<void> {
  const detail = await verification.getVerification(h.ctx, id ?? '');
  const viewer = {
    staff: can(h.ctx, 'canVerifyMembers'),
    access: verification.verificationAccess(h.ctx, detail),
  };
  await h.respond(renderDetail(detail, viewer, h.ctx.config.publicUrl));
}

/**
 * UI gate before a control acts or its form opens: capability refusals are
 * audited by authorize(); the rest (subject, two-person rule, assignment,
 * state) comes from core's verificationAccess. decideVerification,
 * revokeVerification and startReview re-check everything on submit and audit
 * blocked attempts.
 */
async function prepare(h: HandlerContext, id: string | undefined, control: Control) {
  const detail = await verification.getVerification(h.ctx, id ?? '');
  const target = { type: 'verification', id: detail.id };
  await authorize(h.ctx, 'canVerifyMembers', target);
  for (const capability of verification.strategyFor(detail.type).deciderCapabilities)
    await authorize(h.ctx, capability, target);
  const access = verification.verificationAccess(h.ctx, detail);
  if (access.controls.includes(control)) return detail;
  if (access.blocked && access.blocked !== 'closed')
    throw new ForbiddenError(verification.VERIFICATION_BLOCK_MESSAGES[access.blocked]);
  throw new InvalidStateError(
    `${detail.reference} is ${verification.STATUS_LABELS[detail.status]}. That action is no longer available.`,
  );
}

async function decisionModal(
  h: HandlerContext,
  decision: Decision,
  detail: Detail,
): Promise<ModalPayload> {
  const approve = decision === 'approve';
  const note = new LabelBuilder()
    .setLabel(approve ? 'Decision note' : 'Why it is not verified')
    .setDescription('Required. The member sees this note.')
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId(DECISION_FIELDS.note)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(verification.TEXT_LIMITS.note),
    );
  const labels = [note];
  if (approve && detail.type === 'skill') {
    // Only ranks above the subject's verified rank: anything else is refused.
    const [catalog, grantable] = await Promise.all([
      loadCatalog(h.ctx),
      verification.listGrantableRanks(h.ctx, { verificationId: detail.id }),
    ]);
    if (grantable.ranks.length === 0) {
      throw new InvalidStateError(
        `${detail.reference}: already verified at ${grantable.currentVerifiedRank ?? '—'}. There is no higher rank to grant; reject it instead.`,
      );
    }
    const current = grantable.currentVerifiedRank;
    labels.unshift(
      new LabelBuilder()
        .setLabel('Rank to grant')
        .setDescription(
          clip(
            `Requested ${detail.requestedRank ?? '—'}. ${current ? `Verified ${current} now; only higher ranks are listed.` : 'Not verified yet.'}`,
            LABEL_DESCRIPTION_CHARS,
          ),
        )
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(DECISION_FIELDS.grantedRank)
            .setRequired(true)
            .addOptions(
              grantable.ranks.map((code) => ({
                label: code,
                value: code,
                description: clip(
                  catalog.tiers.find((tier) => tier.code === code)?.description ?? code,
                  OPTION_TEXT_CHARS,
                ),
                default: code === detail.requestedRank,
              })),
            ),
        ),
    );
  }
  return new ModalBuilder()
    .setCustomId(verificationId(ACTIONS.decide, decision, detail.id))
    .setTitle(clip(`${approve ? 'APPROVE' : 'REJECT'} ${detail.reference}`, LIMITS.modalTitle))
    .addLabelComponents(...labels)
    .toJSON();
}

function revokeModal(detail: Detail): ModalPayload {
  return new ModalBuilder()
    .setCustomId(verificationId(ACTIONS.revokeSubmit, detail.id))
    .setTitle(clip(`REVOKE ${detail.reference}`, LIMITS.modalTitle))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription(
          'Required. The member sees it. Exactly what the approval changed is reversed.',
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(REVOKE_FIELDS.reason)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(verification.TEXT_LIMITS.reason),
        ),
    )
    .toJSON();
}

/** Staff buttons; false when the action is not a staff one. */
export async function handleStaffComponent(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<boolean> {
  const [id] = args;
  switch (action) {
    case ACTIONS.page: {
      const payload = await queuePayload(h, parseScope(args[1]), parseOffset(args[0]));
      await h.interaction.update(payload);
      return true;
    }
    case ACTIONS.pick:
      await showDetail(h, h.interaction.values[0]);
      return true;
    case ACTIONS.open:
      await showDetail(h, id);
      return true;
    case ACTIONS.claim: {
      await prepare(h, id, 'start_review');
      const started = await verification.startReview(h.ctx, { verificationId: id ?? '' });
      await h.respond({
        embeds: [
          success(
            `IN REVIEW — ${started.reference}`,
            'Assigned to you. Only you can decide it now.',
          ),
        ],
        ephemeral: true,
      });
      return true;
    }
    case ACTIONS.approve:
    case ACTIONS.reject: {
      const decision: Decision = action === ACTIONS.approve ? 'approve' : 'reject';
      const detail = await prepare(h, id, decision);
      await h.interaction.showModal(await decisionModal(h, decision, detail));
      return true;
    }
    case ACTIONS.revoke: {
      const detail = await prepare(h, id, 'revoke');
      await h.interaction.showModal(revokeModal(detail));
      return true;
    }
    default:
      return false;
  }
}

function parseOffset(value: string | undefined): number {
  const offset = Number(value ?? 0);
  if (!Number.isInteger(offset) || offset < 0) throw new ValidationError('Invalid page.');
  return offset;
}

/** Staff modals; false when the action is not a staff one. */
export async function handleStaffModal(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<boolean> {
  const { modal } = h.interaction;
  if (action === ACTIONS.decide) {
    const decision = parseDecision(args[0]);
    if (!decision) throw new ValidationError('Unknown decision.');
    const [grantedRank] = modal.select(DECISION_FIELDS.grantedRank);
    const decided = await verification.decideVerification(h.ctx, {
      verificationId: args[1] ?? '',
      decision,
      note: modal.text(DECISION_FIELDS.note),
      ...(decision === 'approve' && grantedRank ? { grantedRank } : {}),
    });
    await h.respond({
      embeds: [
        success(
          `${decision === 'approve' ? 'VERIFICATION APPROVED' : 'VERIFICATION REJECTED'} — ${decided.reference}`,
          `${targetLine(decided)}. The member is notified.`,
        ),
      ],
      ephemeral: true,
    });
    return true;
  }
  if (action === ACTIONS.revokeSubmit) {
    const revoked = await verification.revokeVerification(h.ctx, {
      verificationId: args[0] ?? '',
      reason: modal.text(REVOKE_FIELDS.reason),
    });
    await h.respond({
      embeds: [
        success(
          `VERIFICATION REVOKED — ${revoked.reference}`,
          `${targetLine(revoked)}. What the approval changed is reversed where it still stands. The member is notified.`,
        ),
      ],
      ephemeral: true,
    });
    return true;
  }
  return false;
}
