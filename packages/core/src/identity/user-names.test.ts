import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '../testing';
import { userNames } from './profile.service';

/** PGlite boots a migrated database per kit; generous on a shared machine. */
const HOOK_TIMEOUT_MS = 120_000;
const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000000';

describe('userNames', () => {
  let kit: TestKit;
  beforeEach(async () => {
    kit = await createTestKit();
  }, HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  }, HOOK_TIMEOUT_MS);

  it('maps user ids to display name, handle and Discord id; unknown ids are omitted', async () => {
    const viewer = await kit.member({ roles: ['verified'] });
    const other = await kit.member({ roles: ['member'], username: 'orbit_lee' });
    const names = await userNames(kit.as(viewer), [other.userId, other.userId, UNKNOWN_USER_ID]);
    expect([...names.keys()]).toEqual([other.userId]);
    expect(names.get(other.userId)).toMatchObject({
      handle: 'orbit_lee',
      discordId: other.discordId,
    });
  });

  it('BREAK: an actor without canViewMembers learns nothing', async () => {
    const applicant = await kit.member({ roles: ['applicant'] });
    const other = await kit.member({ roles: ['member'] });
    expect((await userNames(kit.as(applicant), [other.userId])).size).toBe(0);
  });
});
