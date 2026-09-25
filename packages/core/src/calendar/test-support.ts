import type { ServiceContext } from '../kernel/context';
import type { Actor } from '../permissions/actor';
import { createTestKit, type TestKit } from '../testing';

/**
 * Test-only. The first test kit in a worker builds the migrated PGlite
 * snapshot, which can outlast the default hook timeout on a busy machine.
 * Integration suites warm it up once in `beforeAll` with this budget.
 */
export const SNAPSHOT_BUILD_TIMEOUT_MS = 300_000;

export async function warmUpTestDatabase(): Promise<void> {
  const kit = await createTestKit();
  await kit.close();
}

/**
 * Test-only. A context acting as `actor` on the kit's database whose SQL is
 * recorded (lower-cased) in execution order.
 *
 * PGlite runs every transaction behind one mutex, so `Promise.all`'d service
 * calls never interleave and a missing row lock cannot fail a concurrency
 * test there. Lock tests therefore assert on the statements: the row lock is
 * taken, and taken before the read it protects.
 */
export function recordingContext(
  kit: TestKit,
  actor: Actor,
): { ctx: ServiceContext; statements: string[] } {
  const statements: string[] = [];
  const db = kit.database.withQueryLog((query) => statements.push(query.toLowerCase()));
  return { ctx: { ...kit.as(actor), db, rootDb: db }, statements };
}

/** Index of the first statement matching `pattern`, or -1. */
export function statementIndex(statements: readonly string[], pattern: RegExp): number {
  return statements.findIndex((statement) => pattern.test(statement));
}
