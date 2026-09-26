import { ExternalServiceError, getSettings, type ServiceContext } from '@jave/core';
import { DiscordActionError, type DiscordGateway } from '../../discord/gateway';
import { configuredChannelIds, type ReadinessInput } from './readiness';

/** Discord could not answer an introspection call: a safe, retryable error for the user. */
export async function introspect<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof DiscordActionError) {
      throw new ExternalServiceError(
        'discord',
        'JAVE could not read the server from Discord. Try again shortly.',
        !error.permanent,
      );
    }
    throw error;
  }
}

/**
 * Gather everything the readiness check evaluates. Callers authorize first:
 * settings are read with the internal getter.
 */
export async function probeReadiness(
  ctx: ServiceContext,
  gateway: DiscordGateway,
): Promise<ReadinessInput> {
  const [roleSettings, channelSettings] = await Promise.all([
    getSettings(ctx, 'roles'),
    getSettings(ctx, 'channels'),
  ]);
  const [bot, roles, probes] = await introspect(() =>
    Promise.all([
      gateway.botMember(),
      gateway.listRoles(),
      Promise.all(
        configuredChannelIds(channelSettings).map(
          async (id) => [id, await gateway.botPermissionsIn(id)] as const,
        ),
      ),
    ]),
  );
  return { bot, roles, roleSettings, channelSettings, channels: new Map(probes) };
}
