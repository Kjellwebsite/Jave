import type { JobHandlerMap } from '@jave/core';
import type {
  IncomingMessage,
  JoinedMember,
  MessageDeletion,
  MessageUpdate,
} from '../gateway-events/types';
import type { CommandDefinition, ComponentHandler, ModalHandler } from '../interactions/types';
import type { BotServices } from '../runtime';

/**
 * A bot feature: one domain's Discord surface. Features register commands,
 * component/modal handlers, Discord side-effect job handlers ('discord.*'),
 * and gateway-event listeners. main.ts composes all features.
 */
export interface BotFeature {
  name: string;
  commands?: readonly CommandDefinition[];
  components?: readonly ComponentHandler[];
  modals?: readonly ModalHandler[];
  jobHandlers?: (services: BotServices) => JobHandlerMap;
  onReady?: (services: BotServices) => Promise<void>;
  onMessage?: (services: BotServices, message: IncomingMessage) => Promise<void>;
  onMessageUpdate?: (services: BotServices, update: MessageUpdate) => Promise<void>;
  onMessageDelete?: (services: BotServices, deletion: MessageDeletion) => Promise<void>;
  onMemberJoin?: (services: BotServices, member: JoinedMember) => Promise<void>;
  onMemberLeave?: (services: BotServices, userId: string) => Promise<void>;
  onInvitesChanged?: (services: BotServices) => Promise<void>;
}
