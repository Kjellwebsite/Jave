import { isJaveError, type JobHandler, type ServiceContext, trials } from '@jave/core';
import type {
  DiscordGateway,
  PermissionName,
  PermissionOverwriteSpec,
} from '../../../discord/gateway';
import type { BotServices } from '../../../runtime';
import { ignoreUnknown, isUnknownEntity, parsePayload, toJobError, UNKNOWN } from './support';

type EnsureSpec = Extract<trials.ProvisioningSpec, { action: 'ensure' }>;

/** Team members: work in the channel. */
export const MEMBER_ALLOW: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'AttachFiles',
  'EmbedLinks',
  'AddReactions',
];
/** Evaluator roles: follow and ask questions. */
export const EVALUATOR_ALLOW: PermissionName[] = ['ViewChannel', 'ReadMessageHistory', 'SendMessages'];
/**
 * The bot itself. Without Administrator (JAVE never asks for it) the
 * @everyone deny would lock the bot out of the channel it manages, so it
 * keeps exactly what it needs to post the brief, warnings and the record.
 */
export const BOT_ALLOW: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'EmbedLinks',
];

const REASON = 'JAVE trial team channel';

/** The channel's complete overwrite set for the current roster. */
export function teamOverwrites(
  spec: EnsureSpec,
  ids: { guildId: string; botUserId: string },
): PermissionOverwriteSpec[] {
  const members = new Set(spec.memberDiscordIds);
  return [
    { type: 'role', id: ids.guildId, deny: ['ViewChannel'] },
    { type: 'member', id: ids.botUserId, allow: BOT_ALLOW },
    ...[...members].map((id): PermissionOverwriteSpec => ({ type: 'member', id, allow: MEMBER_ALLOW })),
    ...spec.evaluatorRoleIds.map(
      (id): PermissionOverwriteSpec => ({ type: 'role', id, allow: EVALUATOR_ALLOW }),
    ),
    // A member deny beats a role allow: stakeholding staff never see other teams.
    ...spec.denyDiscordIds
      .filter((id) => !members.has(id))
      .map((id): PermissionOverwriteSpec => ({ type: 'member', id, deny: ['ViewChannel'] })),
  ];
}

interface Created {
  channelId: string | null;
  roleId: string | null;
}

/** Make the team role's holders exactly the roster. Members who left the guild are skipped. */
async function syncRoleHolders(gateway: DiscordGateway, roleId: string, want: readonly string[]) {
  const holders = new Set(await gateway.roleMemberIds(roleId));
  for (const userId of want) {
    if (holders.has(userId)) continue;
    await ignoreUnknown(() => gateway.addRoles(userId, [roleId], REASON), UNKNOWN.member);
  }
  for (const userId of holders) {
    if (want.includes(userId)) continue;
    await ignoreUnknown(() => gateway.removeRoles(userId, [roleId], REASON), UNKNOWN.member);
  }
}

async function ensureRole(
  gateway: DiscordGateway,
  spec: EnsureSpec,
  created: Created,
): Promise<string | null> {
  if (!spec.createRole) return spec.existingRoleId;
  if (spec.existingRoleId) {
    try {
      await syncRoleHolders(gateway, spec.existingRoleId, spec.memberDiscordIds);
      return spec.existingRoleId;
    } catch (error) {
      // Deleted by hand: create a replacement below.
      if (!isUnknownEntity(error, UNKNOWN.role)) throw error;
    }
  }
  const roleId = await gateway.createRole({ name: spec.roleName, reason: REASON });
  created.roleId = roleId;
  await syncRoleHolders(gateway, roleId, spec.memberDiscordIds);
  return roleId;
}

async function ensureChannel(
  gateway: DiscordGateway,
  spec: EnsureSpec,
  overwrites: PermissionOverwriteSpec[],
  created: Created,
): Promise<string> {
  if (spec.existingChannelId) {
    try {
      await gateway.setChannelOverwrites(spec.existingChannelId, overwrites, REASON);
      return spec.existingChannelId;
    } catch (error) {
      // Deleted by hand: recreate it so the team is never left without a channel.
      if (!isUnknownEntity(error, UNKNOWN.channel)) throw error;
    }
  }
  const channelId = await gateway.createTextChannel({
    name: spec.channelName,
    parentId: spec.parentCategoryId,
    topic: spec.topic,
    overwrites,
    reason: REASON,
  });
  created.channelId = channelId;
  return channelId;
}

/** The team was reshuffled away while we worked: remove only what this run created. */
async function discardCreated(gateway: DiscordGateway, created: Created): Promise<void> {
  if (created.channelId)
    await ignoreUnknown(
      () => gateway.deleteChannel(created.channelId!, 'JAVE trial team reshuffled'),
      UNKNOWN.channel,
    );
  if (created.roleId)
    await ignoreUnknown(
      () => gateway.deleteRole(created.roleId!, 'JAVE trial team reshuffled'),
      UNKNOWN.role,
    );
}

async function report(
  ctx: ServiceContext,
  gateway: DiscordGateway,
  input: { teamId: string; channelId: string; roleId: string | null },
  created: Created,
): Promise<Record<string, unknown>> {
  try {
    await trials.markTeamProvisioned(ctx, input);
    return { channelId: input.channelId, roleId: input.roleId };
  } catch (error) {
    if (!isJaveError(error) || error.code !== 'NOT_FOUND') throw error;
    await discardCreated(gateway, created);
    return { orphaned: input.channelId };
  }
}

/**
 * discord.trials.provision — create or re-sync one team's private channel
 * (and optional team role) from the current roster. Re-runs converge:
 * overwrites are replaced wholesale, role holders reconciled.
 */
export function provisionHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const { teamId } = parsePayload(trials.provisionJobSchema, payload);
    // INVALID_STATE (no trials category) dead-letters: configure it, then reprovision.
    const spec = await trials.getTeamProvisioningSpec(ctx, { teamId });
    if (spec.action === 'skip') return { skipped: spec.reason };
    const { gateway } = services;
    const created: Created = { channelId: null, roleId: null };
    try {
      const roleId = await ensureRole(gateway, spec, created);
      const overwrites = teamOverwrites(spec, {
        guildId: services.discord.guildId,
        botUserId: services.discord.clientId,
      });
      const channelId = await ensureChannel(gateway, spec, overwrites, created);
      return await report(ctx, gateway, { teamId: spec.teamId, channelId, roleId }, created);
    } catch (error) {
      // Unreported resources would be duplicated by the retry: remove them first (best effort).
      await discardCreated(gateway, created).catch((cleanupError: unknown) =>
        ctx.logger.warn({ err: cleanupError, teamId }, 'could not remove unreported team resources'),
      );
      throw toJobError(error);
    }
  };
}
