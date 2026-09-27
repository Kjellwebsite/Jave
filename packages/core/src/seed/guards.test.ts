import { describe, expect, it } from 'vitest';
import { isLocalHost, parseDatabaseTarget, seedRefusal } from './guards';

const LOCAL_URL = 'postgres://jave:secret-password@localhost:5432/jave_dev';

describe('development seed guards', () => {
  it('allows a seed, and a reset, against a local development database', () => {
    expect(
      seedRefusal({ nodeEnv: 'development', databaseUrl: LOCAL_URL, reset: false }),
    ).toBeNull();
    expect(seedRefusal({ nodeEnv: 'development', databaseUrl: LOCAL_URL, reset: true })).toBeNull();
    expect(
      seedRefusal({
        nodeEnv: 'test',
        databaseUrl: 'postgresql://jave@postgres:5432/jave',
        reset: true,
      }),
    ).toBeNull();
  });

  it('BREAK: never runs under NODE_ENV=production, whatever the URL', () => {
    const refusal = seedRefusal({ nodeEnv: 'production', databaseUrl: LOCAL_URL, reset: false });
    expect(refusal).toMatch(/NODE_ENV is production/);
  });

  it('BREAK: refuses URLs that name production, in the host or the database', () => {
    for (const databaseUrl of [
      'postgres://jave@db.prod.example.com:5432/jave',
      'postgres://jave@localhost:5432/jave_production',
      'postgres://jave@PROD-db:5432/jave',
    ]) {
      expect(
        seedRefusal({ nodeEnv: 'development', databaseUrl, reset: false }),
        databaseUrl,
      ).toMatch(/names production/);
    }
  });

  it('BREAK: resets only local databases; a managed host may be seeded but never emptied', () => {
    const managed = 'postgres://jave:pw@jave-staging.abc123.eu-west-1.rds.amazonaws.com:5432/jave';
    expect(seedRefusal({ nodeEnv: 'development', databaseUrl: managed, reset: false })).toBeNull();
    expect(seedRefusal({ nodeEnv: 'development', databaseUrl: managed, reset: true })).toMatch(
      /only runs against a local database/,
    );
  });

  it('BREAK: refuses a missing or malformed URL, and never echoes credentials', () => {
    expect(seedRefusal({ nodeEnv: 'development', databaseUrl: undefined, reset: false })).toMatch(
      /not set/,
    );
    for (const databaseUrl of [
      'mysql://root@localhost/jave',
      'not a url',
      'postgres://localhost',
    ]) {
      expect(
        seedRefusal({ nodeEnv: 'development', databaseUrl, reset: false }),
        databaseUrl,
      ).toMatch(/not a postgres:\/\/ URL/);
    }
    const refusal = seedRefusal({
      nodeEnv: 'development',
      databaseUrl: 'postgres://admin:hunter2-secret@db.prod.internal:5432/jave',
      reset: true,
    });
    expect(refusal).not.toContain('hunter2');
    expect(refusal).not.toContain('admin');
  });

  it('recognizes local hosts', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '127.1.2.3',
      '::1',
      '[::1]',
      'db.localhost',
      'postgres',
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
    for (const host of ['db.example.com', '10.0.0.5', 'fe80::1']) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it('parses the host and database of a postgres URL', () => {
    expect(parseDatabaseTarget('postgres://u:p@LocalHost:5432/jave%5Fdev')).toEqual({
      host: 'localhost',
      database: 'jave_dev',
    });
    expect(parseDatabaseTarget('postgres://u:p@localhost:5432/')).toBeNull();
  });
});
