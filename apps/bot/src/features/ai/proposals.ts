import { ai, InvalidStateError, isUuid } from '@jave/core';
import { customId } from '../../interactions/custom-id';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, failure, field, panel, row, success } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { AI_NS } from './answers';

/**
 * PREVIEW → CONFIRM → EXECUTE → REPORT on Discord. The preview shows exactly
 * what core stored; CONFIRM calls core as the clicking member (core checks the
 * kind's capability, requester/confirmer rules, expiry and the payload hash),
 * and the REPORT replaces the preview. Custom ids only carry the proposal id.
 */

const KIND_LABELS: Readonly<Record<string, string>> = {
  create_task: 'DRAFT MISSION',
  draft_announcement: 'ANNOUNCEMENT',
  create_research_item: 'SAVE TO RESEARCH LIBRARY',
};
const CANCEL_REASON = 'Cancelled in Discord.';
const PROCESS_LINE = 'PREVIEW → CONFIRM → EXECUTE → REPORT';

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.toUpperCase();
}

/** The PREVIEW card with CONFIRM / CANCEL. Nothing has executed yet. */
export function proposalPreview(
  proposal: ai.ProposalView,
  warnings: readonly ai.AiWarning[] = [],
): ReplyPayload {
  const fields = [
    field('Kind', kindLabel(proposal.kind), true),
    field('Confirm requires', `\`${proposal.capabilityToConfirm}\``, true),
    field('Expires', discordTime(proposal.expiresAt, 'R'), true),
  ];
  if (warnings.includes('possible_prompt_injection')) {
    fields.push(
      field(
        'Notice',
        'The source text contains instruction-like content. Review before confirming.',
      ),
    );
  }
  return {
    embeds: [
      panel({
        kicker: 'JAVE AI · PROPOSAL',
        title: `Preview ${GLYPH.dot} ${kindLabel(proposal.kind)}`,
        // Core sanitized the preview for Discord when it stored the proposal.
        description: proposal.preview,
        fields,
        color: COLORS.info,
        footer: `Nothing has executed. ${PROCESS_LINE}`,
      }),
    ],
    components: [
      row(
        button('Confirm', customId(AI_NS, 'confirm', proposal.id), 'success'),
        button('Cancel', customId(AI_NS, 'cancel', proposal.id), 'secondary'),
      ),
    ],
    ephemeral: true,
  };
}

function reportPayload(report: ai.ActionReport): ReplyPayload {
  const embed = success(
    report.status === 'executed' ? 'Executed' : 'Confirmed',
    userText(report.summary, 1000),
  );
  embed.fields = [field('Kind', kindLabel(report.kind), true)];
  embed.footer = { text: PROCESS_LINE };
  return { embeds: [embed], components: [] };
}

function closedPayload(proposal: ai.ProposalView): ReplyPayload {
  if (proposal.status === 'expired') {
    return {
      embeds: [
        failure('EXPIRED', 'This proposal expired before it was confirmed. Draft it again.'),
      ],
      components: [],
    };
  }
  if (proposal.status === 'failed') {
    return {
      embeds: [failure('NOT EXECUTED', userText(proposal.error ?? 'Execution failed.', 500))],
      components: [],
    };
  }
  const status = proposal.status;
  return {
    embeds: [
      panel({
        title: `Proposal ${status}`,
        description: 'This proposal was already decided. Nothing else happened.',
        color: COLORS.steel,
      }),
    ],
    components: [],
  };
}

/**
 * A proposal that could not be decided (expired, already decided, or its
 * execution refused): re-read it as the clicking member and show its real state.
 */
async function showClosedState(h: HandlerContext, proposalId: string, error: InvalidStateError) {
  const current = await ai.getProposal(h.ctx, { proposalId });
  if (current.status === 'pending') throw error;
  await h.interaction.update(closedPayload(current));
}

export async function confirmFromButton(h: HandlerContext, proposalId: string): Promise<void> {
  if (!isUuid(proposalId)) return expiredControl(h);
  try {
    const report = await ai.confirmProposal(h.ctx, { proposalId });
    await h.interaction.update(reportPayload(report));
  } catch (error) {
    if (error instanceof InvalidStateError) return showClosedState(h, proposalId, error);
    throw error;
  }
}

export async function cancelFromButton(h: HandlerContext, proposalId: string): Promise<void> {
  if (!isUuid(proposalId)) return expiredControl(h);
  try {
    await ai.rejectProposal(h.ctx, { proposalId, reason: CANCEL_REASON });
    await h.interaction.update({
      embeds: [
        panel({
          title: 'Proposal cancelled',
          description: 'Nothing was executed.',
          color: COLORS.steel,
        }),
      ],
      components: [],
    });
  } catch (error) {
    if (error instanceof InvalidStateError) return showClosedState(h, proposalId, error);
    throw error;
  }
}

export async function expiredControl(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}
