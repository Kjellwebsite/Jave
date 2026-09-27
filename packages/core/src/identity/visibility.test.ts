import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { memberCapabilities, members } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import type { UserActor } from '../permissions/actor';
import { rankingBoard } from './capabilities.service';
import { listMembers } from './users.service';

const FACET = 'create.projects';

describe('member lists follow profile privacy', () => {
  let kit: TestKit;
  let moderator: UserActor;
  let viewer: UserActor;
  let open: UserActor;
  let hidden: UserActor;
  let banned: UserActor;
  let restricted: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    moderator = await kit.member({ roles: ['moderator'], username: 'mod' });
    viewer = await kit.member({ roles: ['verified'], username: 'viewer' });
    open = await kit.member({ roles: ['verified'], username: 'open' });
    hidden = await kit.member({ roles: ['verified'], username: 'hidden' });
    banned = await kit.member({ roles: ['verified'], username: 'banned' });
    restricted = await kit.member({ roles: ['verified'], username: 'restricted' });
    const set = (actor: UserActor, values: Partial<typeof members.$inferInsert>) =>
      kit.db.update(members).set(values).where(eq(members.id, actor.memberId!));
    await set(hidden, { profileVisibility: 'staff' });
    await set(viewer, { profileVisibility: 'staff' });
    await set(banned, { standing: 'banned' });
    await set(restricted, { standing: 'restricted' });
    for (const actor of [open, hidden, banned, restricted]) {
      await kit.db.insert(memberCapabilities).values({
        memberId: actor.memberId!,
        facetKey: FACET,
        verifiedRank: 'B',
        verifiedAt: kit.clock.now(),
      });
    }
  });
  afterEach(async () => {
    await kit.close();
  });

  const ids = (items: { id?: string; memberId?: string }[]) =>
    items.map((item) => item.id ?? item.memberId).sort();

  it('BREAK: a member never lists banned members or staff-only profiles, nor sees standing', async () => {
    const page = await listMembers(kit.as(viewer), { limit: 50 });
    expect(ids(page.items)).toEqual(
      [moderator, viewer, open, restricted].map((a) => a.memberId).sort(),
    );
    expect(page.total).toBe(4);
    expect(page.items.every((item) => item.standing === null)).toBe(true);
    // The viewer's own staff-only row stays visible to them.
    expect(ids(page.items)).toContain(viewer.memberId);
  });

  it('BREAK: filtering by standing is ignored for non-staff (no standing oracle)', async () => {
    const probe = await listMembers(kit.as(viewer), { standing: 'restricted', limit: 50 });
    expect(probe.total).toBe(4);
  });

  it('staff see everyone with standing and may filter by it', async () => {
    const page = await listMembers(kit.as(moderator), { limit: 50 });
    expect(page.total).toBe(6);
    const restrictedRow = page.items.find((item) => item.id === restricted.memberId);
    expect(restrictedRow?.standing).toBe('restricted');
    const filtered = await listMembers(kit.as(moderator), { standing: 'banned' });
    expect(ids(filtered.items)).toEqual([banned.memberId]);
  });

  it('BREAK: a ranking board never lists someone whose profile the viewer could not open', async () => {
    const board = await rankingBoard(kit.as(viewer), FACET);
    expect(ids(board)).toEqual([open, restricted].map((a) => a.memberId).sort());
    const staffBoard = await rankingBoard(kit.as(moderator), FACET);
    expect(ids(staffBoard)).toEqual(
      [open, hidden, banned, restricted].map((a) => a.memberId).sort(),
    );
  });
});
