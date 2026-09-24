import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Every variable JAVE reads is declared here, once. Apps compose the fragments
 * they need; nothing else in the codebase reads `process.env` directly.
 */

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );

const booleanFlag = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)');

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'must be a postgres:// connection string',
    ),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export const discordEnvSchema = z.object({
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  /** Discord user IDs granted FOUNDER on first contact. Bootstrap only. */
  JAVE_FOUNDER_DISCORD_IDS: csv,
});

export const botEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(discordEnvSchema.shape)
  .extend({
    DISCORD_TOKEN: z.string().min(50, 'DISCORD_TOKEN looks malformed'),
    BOT_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    JAVE_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    JAVE_WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  });

export const aiEnvSchema = z.object({
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'openai-compatible', 'disabled']).default('disabled'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(50),
});

export const integrationsEnvSchema = z.object({
  /** 32-byte key (base64) used to encrypt integration secrets at rest. */
  JAVE_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || Buffer.from(value, 'base64').length === 32,
      'must be 32 bytes, base64 encoded (openssl rand -base64 32)',
    ),
  GITHUB_WEBHOOK_SECRET: z.string().min(16).optional(),
  SIDUS_API_URL: z.string().url().optional(),
  SIDUS_API_KEY: z.string().optional(),
});

export const dashboardEnvSchema = baseEnvSchema
  .extend(databaseEnvSchema.shape)
  .extend(discordEnvSchema.shape)
  .extend(aiEnvSchema.shape)
  .extend(integrationsEnvSchema.shape)
  .extend({
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    JAVE_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
    JAVE_SESSION_SECRET: z.string().min(32, 'JAVE_SESSION_SECRET must be at least 32 characters'),
    /** MOCK / DEVELOPMENT ONLY — enables password-less dev login. Refused in production. */
    JAVE_DEV_AUTH: booleanFlag,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JAVE_DEV_AUTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['JAVE_DEV_AUTH'],
        message: 'JAVE_DEV_AUTH must never be enabled in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.DISCORD_CLIENT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISCORD_CLIENT_SECRET'],
        message: 'DISCORD_CLIENT_SECRET is required in production (Discord OAuth login)',
      });
    }
  });

export const fullBotEnvSchema = botEnvSchema
  .extend(aiEnvSchema.shape)
  .extend(integrationsEnvSchema.shape);

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type BotEnv = z.infer<typeof fullBotEnvSchema>;
export type DashboardEnv = z.infer<typeof dashboardEnvSchema>;
export type AiEnv = z.infer<typeof aiEnvSchema>;
export type IntegrationsEnv = z.infer<typeof integrationsEnvSchema>;

export class EnvError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvError';
    this.issues = issues;
  }
}

/**
 * Parse an environment source against a schema. Error messages name the
 * variable and the problem but never echo the value (it may be a secret).
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  // Treat empty strings as unset so `.env` placeholders like `FOO=` behave.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
