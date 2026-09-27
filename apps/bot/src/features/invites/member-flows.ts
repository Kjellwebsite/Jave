import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import {
  DAY,
  getMemberById,
  getSettings,
  invites,
  type MemberRecord,
  requireMember,
} from '@jave/core';
import type { HandlerContext, ModalPayload, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { success } from '../../ui/components';
import { userText } from '../../ui/format';
import {
  INVITES_NS,
  LEADERBOARD_ROWS,
  type LeaderboardPeriod,
  periodDays,
  renderCodes,
  renderLeaderboard,
  renderMine,
} from './views';

/** Longest referral code a member can type (the core pattern allows 4–32). */
const REFERRAL_CODE_MAX_LENGTH = 32;
const REFERRAL_CODE_MIN_LENGTH = 4;

/** How a component-triggered view is delivered: a new reply, or replacing the panel. */
export type Delivery = 'reply' | 'update';

export async function deliver(h: HandlerContext, payload: ReplyPayload, mode: Delivery) {
  if (mode === 'update') return h.interaction.update(payload);
  return h.respond(payload);
}

export async function showMine(h: HandlerContext, mode: Delivery): Promise<void> {
  const [view, analytics] = await Promise.all([
    invites.getMyReferrals(h.ctx),
    getSettings(h.ctx, 'analytics'),
  ]);
  await deliver(
    h,
    renderMine(view, {
      retentionDays: analytics.retentionDays,
      validRequiresOnboarding: analytics.validRequiresOnboarding,
    }),
    mode,
  );
}

/**
 * UI hint only (core decides): offer "enter a code" to members who have not
 * used one and joined within the claim window.
 */
function mayEnterCode(member: MemberRecord, view: invites.MyReferralsView, now: Date): boolean {
  if (view.usedCode || member.guildStatus !== 'present' || !member.joinedGuildAt) return false;
  return now.getTime() - member.joinedGuildAt.getTime() <= invites.REFERRAL_CLAIM_WINDOW_DAYS * DAY;
}

export async function showCodes(
  h: HandlerContext,
  mode: Delivery,
  notice?: { title: string; description: string },
): Promise<void> {
  const actor = requireMember(h.ctx);
  const [view, member] = await Promise.all([
    invites.getMyReferrals(h.ctx),
    getMemberById(h.ctx, actor.memberId),
  ]);
  await deliver(
    h,
    renderCodes(view, {
      maxActive: invites.MAX_ACTIVE_REFERRAL_CODES_PER_MEMBER,
      claimWindowDays: invites.REFERRAL_CLAIM_WINDOW_DAYS,
      canEnterCode: mayEnterCode(member, view, h.ctx.clock.now()),
      notice,
    }),
    mode,
  );
}

/** A new random personal code for the clicking member (core enforces the cap). */
export async function createCode(h: HandlerContext): Promise<void> {
  const code = await invites.createReferralCode(h.ctx, {});
  await showCodes(h, 'update', {
    title: 'CODE CREATED',
    description: `\`${code.code}\` is active. Share it with people you bring in.`,
  });
}

/** Deactivate one of the clicking member's codes. Someone else's code reads as unknown. */
export async function deactivateCode(h: HandlerContext): Promise<void> {
  const [code] = h.interaction.values;
  const row = await invites.deactivateReferralCode(h.ctx, { code: code ?? '' });
  await showCodes(h, 'update', {
    title: 'CODE DEACTIVATED',
    description: `\`${row.code}\` no longer credits new claims. Past referrals keep their credit.`,
  });
}

export function claimModal(): ModalPayload {
  return new ModalBuilder()
    .setCustomId(customId(INVITES_NS, 'claim'))
    .setTitle('ENTER A REFERRAL CODE')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Referral code')
        .setDescription('The code of the member who brought you to JAVELIN.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('code')
            .setStyle(TextInputStyle.Short)
            .setMinLength(REFERRAL_CODE_MIN_LENGTH)
            .setMaxLength(REFERRAL_CODE_MAX_LENGTH)
            .setRequired(true),
        ),
    )
    .toJSON();
}

/** Credit the clicking member's join to a referral code (core: once, in window, rate-limited). */
export async function claimCode(h: HandlerContext): Promise<void> {
  const result = await invites.claimReferralCode(h.ctx, { code: h.interaction.modal.text('code') });
  const rules = await getSettings(h.ctx, 'analytics');
  const condition = rules.validRequiresOnboarding
    ? 'once you stay and complete onboarding'
    : 'once you stay';
  await h.respond({
    embeds: [
      success(
        'REFERRAL RECORDED',
        `Your join is credited to ${userText(result.referrerName, 64)}. It counts ${condition}.`,
      ),
    ],
    ephemeral: true,
  });
}

export async function showLeaderboard(
  h: HandlerContext,
  period: LeaderboardPeriod,
  options: { mode: Delivery; ephemeral: boolean },
): Promise<void> {
  const entries = await invites.getReferralLeaderboard(h.ctx, {
    periodDays: periodDays(period),
    limit: LEADERBOARD_ROWS,
  });
  await deliver(
    h,
    renderLeaderboard(entries, period, { ephemeral: options.ephemeral }),
    options.mode,
  );
}
