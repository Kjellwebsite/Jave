import { createTestKit } from '../../testing';

/**
 * The first test database of a worker builds the migrated PGlite snapshot,
 * which can take minutes on a loaded machine. Doing it in a beforeAll with a
 * generous timeout keeps that cost out of the per-test hook timeout.
 */
export const WARM_UP_TIMEOUT_MS = 300_000;

/**
 * Database-backed tests in these modules create a fresh PGlite per test.
 * On a shared, heavily loaded machine that alone can exceed the package
 * defaults, so hooks and tests get explicit, generous ceilings.
 */
export const DB_HOOK_TIMEOUT_MS = 180_000;
export const DB_TEST_TIMEOUT_MS = 180_000;

export async function warmTestDatabase(): Promise<void> {
  const kit = await createTestKit();
  await kit.close();
}
