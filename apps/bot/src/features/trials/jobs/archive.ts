import { type JobHandler, trials } from '@jave/core';
import type { DiscordGateway, PermissionName } from '../../../discord/gateway';
import type { BotServices } from '../../../runtime';
import { closingMessage } from '../render/cards';
import { ignoreUnknown, isUnknownEntity, parsePayload, toJobError, UNKNOWN } from './support';

type ArchiveTeam = Extract<trials.ArchiveSpec, { action: 'archive' }>['teams'][number];

/** Members keep reading their record; nobody writes in it anymore. */
export const ARCHIVED_MEMBER_ALLOW: PermissionName[] = ['ViewChannel', 'ReadMessageHistory'];
export const ARCHIVED_MEMBER_DENY: PermissionName[] = ['SendMessages', 'AddReactions'];

const ARCHIVE_REASON = 'JAVE trial ended — channel kept read-only';
const TEARDOWN_REASON = 'JAVE trial team reshuffled';

/**
 * Lock one team channel. The only non-idempotent step — the closing post —
 * runs last, so a retry after a partial failure never posts it twice.
 */
async function archiveTeam(
  gateway: DiscordGateway,
  team: ArchiveTeam,
  closing: ReturnType<typeof closingMessage>,
): Promise<void> {
  for (const userId of team.memberDiscordIds) {
    await gateway.setChannelOverwrite(
      team.channelId,
      { type: 'member', id: userId, allow: ARCHIVED_MEMBER_ALLOW, deny: ARCHIVED_MEMBER_DENY },
      ARCHIVE_REASON,
    );
  }
  await gateway.renameChannel(team.channelId, team.archivedChannelName, ARCHIVE_REASON);
  if (team.roleId)
    await ignoreUnknown(() => gateway.deleteRole(team.roleId!, ARCHIVE_REASON), UNKNOWN.role);
  await gateway.sendMessage(team.channelId, closing);
}

/**
 * discord.trials.archive — make every team channel of a finished trial
 * read-only, keeping it as the record. Teams handled are reported even when
 * another team fails, so a retry only touches what is left.
 */
export function archiveHandler(services: BotServices): JobHandler {
  return async (ctx, payload) => {
    const { trialId } = parsePayload(trials.archiveJobSchema, payload);
    const spec = await trials.getArchiveSpec(ctx, { trialId });
    if (spec.action === 'skip') return { skipped: spec.reason };
    const closing = closingMessage(spec.closingMessage, spec.finalStatus);
    const handled: string[] = [];
    let failure: unknown = null;
    for (const team of spec.teams) {
      try {
        await archiveTeam(services.gateway, team, closing);
        handled.push(team.teamId);
      } catch (error) {
        // A channel deleted by hand has nothing left to lock.
        if (isUnknownEntity(error, UNKNOWN.channel)) handled.push(team.teamId);
        else failure ??= error;
      }
    }
    if (handled.length > 0)
      await trials.markTeamsArchived(ctx, { trialId: spec.trialId, teamIds: handled });
    if (failure) throw toJobError(failure);
    return { archived: handled.length };
  };
}

/** discord.trials.teardown — delete a reshuffled team's channel and role. Unknown = done. */
export function teardownHandler(services: BotServices): JobHandler {
  return async (_ctx, payload) => {
    const data = parsePayload(trials.teardownJobSchema, payload);
    try {
      if (data.channelId)
        await ignoreUnknown(
          () => services.gateway.deleteChannel(data.channelId!, TEARDOWN_REASON),
          UNKNOWN.channel,
        );
      if (data.roleId)
        await ignoreUnknown(
          () => services.gateway.deleteRole(data.roleId!, TEARDOWN_REASON),
          UNKNOWN.role,
        );
      return { deletedChannel: data.channelId, deletedRole: data.roleId };
    } catch (error) {
      throw toJobError(error);
    }
  };
}
