import type { BotFeature } from '../types';
import {
  invitesCommand,
  invitesComponents,
  invitesModals,
  referralFunnelContextCommand,
} from './commands';
import { trackerFor } from './tracker';

/**
 * Discord surface for the invites domain: referral funnel, codes and
 * leaderboard for members, campaigns for staff, and the invite tracker that
 * feeds join attribution. The module defines no 'discord.*' job contracts:
 * the bot feeds core directly from gateway events.
 */
export const feature: BotFeature = {
  name: 'invites',
  commands: [invitesCommand, referralFunnelContextCommand],
  components: [invitesComponents],
  modals: [invitesModals],
  onReady: async (services) => {
    await trackerFor(services).resync('ready');
  },
  onInvitesChanged: async (services) => {
    await trackerFor(services).resync('changed');
  },
  onMemberJoin: async (services, member) => {
    if (member.bot) return;
    const outcome = await trackerFor(services).attributeJoin(member);
    services.logger.info(
      { method: outcome.method, reason: outcome.reason, created: outcome.created },
      'join attributed',
    );
  },
};
