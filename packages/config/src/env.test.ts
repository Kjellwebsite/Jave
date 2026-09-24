import { describe, expect, it } from 'vitest';
import { EnvError, dashboardEnvSchema, fullBotEnvSchema, parseEnv } from './env';

const validBot = {
  DATABASE_URL: 'postgres://jave:jave@localhost:5432/jave',
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_GUILD_ID: '123456789012345679',
  DISCORD_TOKEN: 'x'.repeat(70),
};

describe('parseEnv', () => {
  it('parses a valid bot environment with defaults', () => {
    const env = parseEnv(fullBotEnvSchema, validBot);
    expect(env.NODE_ENV).toBe('development');
    expect(env.BOT_HEALTH_PORT).toBe(8080);
    expect(env.AI_PROVIDER).toBe('disabled');
    expect(env.JAVE_FOUNDER_DISCORD_IDS).toEqual([]);
  });

  it('splits founder ids', () => {
    const env = parseEnv(fullBotEnvSchema, {
      ...validBot,
      JAVE_FOUNDER_DISCORD_IDS: ' 111111111111111111 , 222222222222222222,',
    });
    expect(env.JAVE_FOUNDER_DISCORD_IDS).toEqual(['111111111111111111', '222222222222222222']);
  });

  it('reports missing variables without echoing values', () => {
    try {
      parseEnv(fullBotEnvSchema, { ...validBot, DISCORD_TOKEN: 'secret-short' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).toContain('DISCORD_TOKEN');
      expect((error as Error).message).not.toContain('secret-short');
    }
  });

  it('treats empty strings as unset', () => {
    const env = parseEnv(fullBotEnvSchema, { ...validBot, AI_MODEL: '' });
    expect(env.AI_MODEL).toBeUndefined();
  });

  it('rejects dev auth in production', () => {
    expect(() =>
      parseEnv(dashboardEnvSchema, {
        ...validBot,
        NODE_ENV: 'production',
        JAVE_SESSION_SECRET: 's'.repeat(40),
        DISCORD_CLIENT_SECRET: 'client-secret',
        JAVE_DEV_AUTH: 'true',
      }),
    ).toThrow(/JAVE_DEV_AUTH/);
  });

  it('rejects malformed encryption keys', () => {
    expect(() =>
      parseEnv(fullBotEnvSchema, { ...validBot, JAVE_ENCRYPTION_KEY: 'too-short' }),
    ).toThrow(/JAVE_ENCRYPTION_KEY/);
  });
});
