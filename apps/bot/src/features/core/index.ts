import { DISCORD_ROLE_SYNC_JOB, NOTIFICATION_DELIVER_JOB } from '@jave/core';
import type { CommandDefinition } from '../../interactions/types';
import type { BotFeature } from '../types';
import { handleMemberJoin, handleMemberLeave } from './gateway';
import { createHelpCommand } from './help';
import { notificationDeliveryHandler } from './notification-delivery';
import { onboardingComponents, onboardingModals, startCommand } from './onboarding';
import { profileCommand, profileComponents, profileContextCommand } from './profile';
import { rankCommand } from './rank';
import { roleSyncHandler } from './role-sync';
import { statusCommand } from './status';

/** Identity, onboarding, ranks, help and diagnostics. */
export function coreFeature(catalog: () => readonly CommandDefinition[]): BotFeature {
  return {
    name: 'core',
    commands: [
      createHelpCommand(catalog),
      startCommand,
      profileCommand,
      profileContextCommand,
      rankCommand,
      statusCommand,
    ],
    components: [onboardingComponents, profileComponents],
    modals: [onboardingModals],
    jobHandlers: (services) => ({
      [DISCORD_ROLE_SYNC_JOB]: roleSyncHandler(services),
      [NOTIFICATION_DELIVER_JOB]: notificationDeliveryHandler(services),
    }),
    onMemberJoin: handleMemberJoin,
    onMemberLeave: handleMemberLeave,
  };
}
