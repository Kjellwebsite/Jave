import { moderation } from '@jave/core';
import type { BotFeature } from '../types';
import { moderationAlertHandler } from './alert-job';
import { moderationApplyHandler } from './apply-job';
import { modCommand } from './commands';
import { moderationComponents } from './components';
import {
  deleteWarnContextCommand,
  historyContextCommand,
  quarantineContextCommand,
  reportContextCommand,
} from './context-menus';
import { screenIncomingMessage, screenMemberJoin } from './listeners';
import { moderationDeleteMessagesHandler, moderationLockdownHandler } from './message-jobs';
import { moderationModals } from './modals';
import { raidModeCommand } from './raidmode';

/** Discord surface for the moderation domain. */
export const feature: BotFeature = {
  name: 'moderation',
  commands: [
    modCommand,
    raidModeCommand,
    historyContextCommand,
    quarantineContextCommand,
    reportContextCommand,
    deleteWarnContextCommand,
  ],
  components: [moderationComponents],
  modals: [moderationModals],
  jobHandlers: (services) => ({
    [moderation.DISCORD_MODERATION_APPLY_JOB]: moderationApplyHandler(services),
    [moderation.DISCORD_MODERATION_ALERT_JOB]: moderationAlertHandler(services),
    [moderation.DISCORD_MODERATION_DELETE_MESSAGES_JOB]: moderationDeleteMessagesHandler(services),
    [moderation.DISCORD_MODERATION_LOCKDOWN_JOB]: moderationLockdownHandler(services),
  }),
  onMessage: screenIncomingMessage,
  onMemberJoin: screenMemberJoin,
};
