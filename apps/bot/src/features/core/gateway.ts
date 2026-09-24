import {
  createContext,
  getSettings,
  recordGuildJoin,
  recordGuildLeave,
  systemActor,
} from '@jave/core';
import type { JoinedMember } from '../../gateway-events/types';
import type { BotServices } from '../../runtime';
import { welcomeMessage } from './onboarding';

function systemContext(services: BotServices, reason: string) {
  return createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor(reason),
  });
}

export async function handleMemberJoin(services: BotServices, member: JoinedMember): Promise<void> {
  if (member.bot) return;
  const ctx = systemContext(services, 'gateway:member-join');
  await recordGuildJoin(ctx, {
    discordId: member.id,
    username: member.username,
    displayName: member.globalName,
    avatarHash: member.avatar,
  });
  await services.runJobsNow(ctx.effects.jobIds);
  const channels = await getSettings(ctx, 'channels');
  if (channels.welcome) {
    await services.gateway.sendMessage(channels.welcome, welcomeMessage(member.id));
  }
}

export async function handleMemberLeave(services: BotServices, userId: string): Promise<void> {
  const ctx = systemContext(services, 'gateway:member-leave');
  await recordGuildLeave(ctx, userId);
}
