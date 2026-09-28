import { achievements, requireUser } from '@jave/core';
import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import { failure } from '../../ui/components';
import { presentInPlace } from '../missions/present';
import type { BotFeature } from '../types';
import { achievementsCommand, achievementsContextCommand } from './catalog';
import { resolveMemberId } from './data';
import { announceAchievementHandler, retractAchievementHandler } from './jobs';
import { ACHIEVEMENTS_NS } from './render';
import {
  openAwardModal,
  openRevokeModal,
  openVerifySelect,
  submitAchievementModal,
  verifyChosen,
} from './staff';
import { memberCatalogPayload } from './view';

async function expired(h: HandlerContext): Promise<void> {
  requireUser(h.ctx);
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

/**
 * Buttons and selects. Custom ids route; they never authorize: every action
 * runs through core services as the clicking user.
 */
const components: ComponentHandler = {
  namespace: ACHIEVEMENTS_NS,
  async handle(h, action, args) {
    const [rawMemberId, rawPage] = args;
    if (!rawMemberId) return expired(h);
    const memberId = await resolveMemberId(h, { memberId: rawMemberId });
    switch (action) {
      case 'page': {
        const page = Number(rawPage);
        await presentInPlace(
          h,
          await memberCatalogPayload(h, memberId, {
            page: Number.isInteger(page) ? page : 0,
            share: false,
          }),
        );
        return;
      }
      case 'award':
        return openAwardModal(h, memberId);
      case 'revoke':
        return openRevokeModal(h, memberId);
      case 'verify':
        return openVerifySelect(h, memberId);
      case 'verify_pick':
        return verifyChosen(h, memberId, h.interaction.values);
      default:
        return expired(h);
    }
  },
};

const modals: ModalHandler = {
  namespace: ACHIEVEMENTS_NS,
  async handle(h, action, args) {
    const [rawMemberId] = args;
    if (!rawMemberId || (action !== 'award' && action !== 'revoke')) return expired(h);
    const memberId = await resolveMemberId(h, { memberId: rawMemberId });
    await submitAchievementModal(h, action, memberId);
  },
};

/** Discord surface for the achievements domain. */
export const feature: BotFeature = {
  name: 'achievements',
  commands: [achievementsCommand, achievementsContextCommand],
  components: [components],
  modals: [modals],
  jobHandlers: (services) => ({
    [achievements.DISCORD_ACHIEVEMENT_ANNOUNCE_JOB]: announceAchievementHandler(services),
    [achievements.DISCORD_ACHIEVEMENT_RETRACT_JOB]: retractAchievementHandler(services),
  }),
};
