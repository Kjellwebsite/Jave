import {
  createContext,
  findMemberByDiscordId,
  type ServiceContext,
  syncDiscordUser,
  systemActor,
  upsertDiscordUser,
} from '@jave/core';
import type { HandlerContext, InteractionUser } from '../../interactions/types';
import type { BotServices } from '../../runtime';
import { pendingStoreFor, type PendingStore } from './pending';

/** A system-actor context for gateway listeners and bot-side identity sync. */
export function systemContext(services: BotServices, reason: string): ServiceContext {
  return createContext({
    db: services.db,
    clock: services.clock,
    cache: services.cache,
    config: services.config,
    logger: services.logger,
    actor: systemActor(reason),
  });
}

export function pending(h: HandlerContext): PendingStore {
  return pendingStoreFor(h.services, h.services.clock);
}

function profileOf(user: InteractionUser) {
  return {
    discordId: user.id,
    username: user.username.slice(0, 64) || user.id,
    displayName: user.globalName?.slice(0, 64) ?? null,
    avatarHash: user.avatar,
    isBot: user.bot,
  };
}

/**
 * Make sure JAVE knows a Discord user before a moderation service is called
 * with their Discord ID. The profile comes from Discord's resolved
 * interaction data (never from typed input). Members already known are left
 * untouched; unknown users get a member record only if they are in the
 * server right now. This is identity sync, not authorization — the case
 * services still check the acting user.
 */
export async function ensureKnownUser(services: BotServices, user: InteractionUser): Promise<void> {
  const ctx = systemContext(services, 'moderation:identity-sync');
  if (await findMemberByDiscordId(ctx, user.id)) return;
  const inGuild = (await services.gateway.fetchMember(user.id).catch(() => null)) !== null;
  if (inGuild) await syncDiscordUser(ctx, profileOf(user), { inGuild: true });
  else await upsertDiscordUser(ctx, profileOf(user));
}

/** Display name of a Discord user as Discord resolved it. */
export function displayNameOf(user: InteractionUser): string {
  return user.globalName ?? user.username;
}
