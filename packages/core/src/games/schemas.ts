import { z } from 'zod';
import { gameSurface } from '@jave/database';
import { ABANDON_REASON_MAX, LEADERBOARD_DEFAULT, LEADERBOARD_MAX } from './constants';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');
const CONTROL_CHARACTER = /\p{Cc}/u;

export const createSessionSchema = z
  .object({
    gameKey: z.string().trim().min(1).max(32),
    /** Validated against the game's own config schema. */
    config: z.record(z.string(), z.unknown()).default({}),
    surface: z.enum(gameSurface.enumValues),
    discordChannelId: snowflake.optional(),
    activityInstanceId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[\w-]+$/, 'must be an Activity instance id')
      .optional(),
    /** The host joins as a player (default) or only runs the game. */
    hostPlays: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.surface === 'discord' && !value.discordChannelId) {
      ctx.addIssue({ code: 'custom', path: ['discordChannelId'], message: 'required for Discord' });
    }
    if (value.surface === 'activity' && !value.activityInstanceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['activityInstanceId'],
        message: 'required for an Activity',
      });
    }
    if (value.surface !== 'discord' && value.discordChannelId) {
      ctx.addIssue({ code: 'custom', path: ['discordChannelId'], message: 'only for Discord' });
    }
    if (value.surface !== 'activity' && value.activityInstanceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['activityInstanceId'],
        message: 'only for an Activity',
      });
    }
  });

export const sessionIdSchema = z.object({ sessionId: z.uuid() });

export const abandonSessionSchema = z.object({
  sessionId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(ABANDON_REASON_MAX)
    .refine((value) => !CONTROL_CHARACTER.test(value), 'must be a single line of plain text')
    .optional(),
});

export const submitMoveSchema = z.object({
  sessionId: z.uuid(),
  /** Game-specific; validated against the game's move schema. */
  move: z.unknown(),
  /** The session version the client acted on; a mismatch is rejected as stale. */
  expectedVersion: z.number().int().min(0).optional(),
});

export const findLiveSessionSchema = z
  .object({
    discordChannelId: snowflake.optional(),
    activityInstanceId: z.string().min(1).max(128).optional(),
  })
  .refine(
    (value) => Boolean(value.discordChannelId) !== Boolean(value.activityInstanceId),
    'give exactly one of discordChannelId or activityInstanceId',
  );

export const leaderboardSchema = z.object({
  gameKey: z.string().trim().min(1).max(32),
  metric: z.enum(['wins', 'best_score', 'sessions']).default('wins'),
  limit: z.number().int().min(1).max(LEADERBOARD_MAX).default(LEADERBOARD_DEFAULT),
});

export const markGameMessageSchema = z.object({
  sessionId: z.uuid(),
  channelId: snowflake,
  messageId: snowflake,
});

export const gameChannelUnavailableSchema = z.object({
  sessionId: z.uuid(),
  reason: z.enum(['host_cannot_post', 'bot_cannot_post']),
});
