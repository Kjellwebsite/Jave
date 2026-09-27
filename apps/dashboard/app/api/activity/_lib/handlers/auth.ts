import 'server-only';
import { z } from 'zod';
import {
  DisabledError,
  type DiscordProfile,
  ensureMember,
  ExternalServiceError,
  ForbiddenError,
  recordAudit,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  upsertDiscordUser,
  type UserRecord,
  ValidationError,
  withActor,
  withTransaction,
} from '@jave/core';
import { DEV_PERSONAS, findDevPersona, provisionDevPersona } from '@/server/auth/dev-auth';
import type { ActivityAuthMode, ActivityTokenResponse, DevPersonasResponse } from '../contract';
import type { ActivityDiscordClient, ActivityDiscordSession } from '../discord';
import { activityHandler, clientKey } from '../handler';
import { json, notAvailable, readJsonBody } from '../http';
import { activityInstanceIdSchema } from '../instance';
import { BODY_LIMITS, spendActivityBudget } from '../limits';
import { issueActivityToken } from '../token';

const MAX_CODE_LENGTH = 512;
const MAX_PERSONA_KEY_LENGTH = 32;

const tokenRequestSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .max(MAX_CODE_LENGTH)
      .regex(/^[\w-]+$/, 'must be an authorization code'),
    instanceId: activityInstanceIdSchema,
  })
  .strict();

const devTokenRequestSchema = z
  .object({
    persona: z.string().min(1).max(MAX_PERSONA_KEY_LENGTH),
    instanceId: activityInstanceIdSchema,
  })
  .strict();

interface SignIn {
  instanceId: string;
  mode: ActivityAuthMode;
  secret: string;
  accessToken: string | null;
  audit:
    | { action: 'auth.login'; context: { method: 'discord_activity' } }
    | { action: 'auth.dev_login'; context: { persona: string; mock: true; surface: 'activity' } };
}

/** Audits the sign-in as the user it signs in, then issues the token bound to user + instance. */
async function signIn(ctx: ServiceContext, user: UserRecord, input: SignIn): Promise<Response> {
  const actor = await resolveUserActor(ctx, user.id);
  await recordAudit(withActor(ctx, actor), {
    action: input.audit.action,
    targetType: 'user',
    targetId: user.id,
    context: input.audit.context,
  });
  const issued = issueActivityToken(
    { userId: user.id, instanceId: input.instanceId, mode: input.mode },
    input.secret,
    ctx.clock.now(),
  );
  return json<ActivityTokenResponse>({
    access_token: input.accessToken,
    jave_token: issued.token,
    expiresAt: issued.expiresAt,
    user: { discordId: user.discordId, displayName: actor.displayName },
    mode: input.mode,
  });
}

/**
 * The Discord half of the sign-in. Failures are logged by kind only (a Discord
 * error body may echo credentials) and surface as a calm 502.
 */
async function exchangeCode(
  ctx: ServiceContext,
  discord: ActivityDiscordClient,
  code: string,
): Promise<ActivityDiscordSession> {
  try {
    return await discord.exchange(code);
  } catch (error) {
    const reason =
      error instanceof ExternalServiceError
        ? error.userMessage
        : error instanceof Error
          ? error.name
          : 'unknown';
    ctx.logger.warn({ reason }, 'activity code exchange failed');
    throw error instanceof ExternalServiceError
      ? error
      : new ExternalServiceError('discord', 'Discord sign-in failed. Try again.');
  }
}

/** Same provisioning as the dashboard's Discord login: user + member, never guild membership. */
async function provisionDiscordUser(
  ctx: ServiceContext,
  profile: DiscordProfile,
): Promise<UserRecord> {
  return withTransaction(withActor(ctx, systemActor('discord-activity-login')), async (tx) => {
    const record = await upsertDiscordUser(tx, profile);
    await ensureMember(tx, record, { inGuild: false });
    return record;
  });
}

/**
 * POST /api/activity/token — `commands.authorize` code → Discord access token
 * + JAVE token bound to the user and the Activity instance. The Discord token
 * is returned for `commands.authenticate` and never stored or logged.
 */
export const handleTokenExchange = activityHandler('activity.token', async (request, deps, ctx) => {
  await spendActivityBudget(ctx, 'token', clientKey(request, deps));
  const body = await readJsonBody(request, tokenRequestSchema, BODY_LIMITS.token);
  if (!deps.discord) throw new DisabledError('Discord sign-in');
  const { accessToken, profile } = await exchangeCode(ctx, deps.discord, body.code);
  if (profile.isBot) throw new ForbiddenError('Bot accounts cannot use the Activity.');
  await spendActivityBudget(ctx, 'tokenUser', profile.discordId);
  const inInstance = await deps.instanceVerifier({
    instanceId: body.instanceId,
    discordUserId: profile.discordId,
  });
  if (!inInstance) throw new ForbiddenError('This Activity session could not be verified.');
  const user = await provisionDiscordUser(ctx, profile);
  return signIn(ctx, user, {
    instanceId: body.instanceId,
    mode: 'discord',
    secret: deps.sessionSecret,
    accessToken,
    audit: { action: 'auth.login', context: { method: 'discord_activity' } },
  });
});

/** GET /api/activity/dev-token — MOCK / DEVELOPMENT ONLY. 404 unless dev auth is enabled. */
export const handleDevPersonas = activityHandler(
  'activity.dev-personas',
  async (_request, deps) => {
    if (!deps.devAuthEnabled) throw notAvailable();
    return json<DevPersonasResponse>({
      personas: DEV_PERSONAS.map(({ key, label, description }) => ({ key, label, description })),
    });
  },
);

/**
 * POST /api/activity/dev-token — MOCK / DEVELOPMENT ONLY. Signs in as a fixed
 * persona without Discord. Refused (404) unless JAVE_DEV_AUTH=true and
 * NODE_ENV is not production; audited as `auth.dev_login`.
 */
export const handleDevToken = activityHandler('activity.dev-token', async (request, deps, ctx) => {
  if (!deps.devAuthEnabled) throw notAvailable();
  await spendActivityBudget(ctx, 'token', clientKey(request, deps));
  const body = await readJsonBody(request, devTokenRequestSchema, BODY_LIMITS.token);
  const persona = findDevPersona(body.persona);
  if (!persona) throw new ValidationError('Unknown persona.');
  const system = withActor(ctx, systemActor('dev-login'));
  const user = await withTransaction(system, (tx) => provisionDevPersona(tx, persona));
  return signIn(ctx, user, {
    instanceId: body.instanceId,
    mode: 'dev',
    secret: deps.sessionSecret,
    accessToken: null,
    audit: {
      action: 'auth.dev_login',
      context: { persona: persona.key, mock: true, surface: 'activity' },
    },
  });
});
