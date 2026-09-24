import { createTestKit } from '../testing';

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
