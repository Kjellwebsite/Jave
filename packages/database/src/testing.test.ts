import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from './testing';
import { capabilityFacets, jobs, members, rankTiers, users } from './schema';
import { CAPABILITY_FACETS, RANK_TIERS } from './reference-data';

describe('test database harness', () => {
  let t: TestDatabase;
  beforeAll(async () => {
    t = await createTestDatabase();
  });
  afterAll(async () => {
    await t.close();
  });

  it('applies reference data', async () => {
    const tiers = await t.db.select().from(rankTiers);
    expect(tiers.map((r) => r.code).sort()).toEqual(RANK_TIERS.map((r) => r.code).sort());
    const facets = await t.db.select().from(capabilityFacets);
    expect(facets).toHaveLength(CAPABILITY_FACETS.length);
  });

  it('enforces foreign keys and unique constraints', async () => {
    const [user] = await t.db
      .insert(users)
      .values({ discordId: '100000000000000001', username: 'kjell' })
      .returning();
    await t.db.insert(members).values({ userId: user!.id, handle: 'kjell', displayName: 'Kjell' });
    await expect(
      t.db.insert(members).values({ userId: user!.id, handle: 'kjell2', displayName: 'Dup' }),
    ).rejects.toThrow();
  });

  it('isolates databases between instances', async () => {
    const other = await createTestDatabase();
    const rows = await other.db.select().from(users).where(eq(users.username, 'kjell'));
    expect(rows).toHaveLength(0);
    await other.close();
  });

  it('supports FOR UPDATE SKIP LOCKED', async () => {
    await t.db.insert(jobs).values({ type: 'test.job', payload: {} });
    const locked = await t.db
      .select()
      .from(jobs)
      .where(eq(jobs.status, 'pending'))
      .for('update', { skipLocked: true })
      .limit(1);
    expect(locked).toHaveLength(1);
  });
});
