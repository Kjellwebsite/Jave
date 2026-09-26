import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ForbiddenError, listMembers, type UserActor } from '@jave/core';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { members } from '@jave/database';
import { loadMemberDirectory } from './member-directory';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

type Standing = 'good' | 'restricted' | 'quarantined' | 'banned';
type Visibility = 'public' | 'members' | 'staff';

async function seedMember(
  username: string,
  options: { standing?: Standing; visibility?: Visibility; roles?: ('verified' | 'trial')[] } = {},
): Promise<UserActor> {
  const actor = await kit.member({ username, roles: options.roles });
  await kit.db
    .update(members)
    .set({
      standing: options.standing ?? 'good',
      profileVisibility: options.visibility ?? 'members',
    })
    .where(eq(members.id, actor.memberId!));
  return actor;
}

describe('member directory privacy', () => {
  it('shows staff every member with standing, and honours the standing filter', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    await seedMember('ayla', { standing: 'restricted' });
    await seedMember('bram', { standing: 'banned' });
    await seedMember('cleo', { visibility: 'staff' });

    const directory = await loadMemberDirectory(kit.as(founder), { sort: 'name' });
    expect(directory.staffView).toBe(true);
    expect(directory.page.total).toBe(4);
    const standings = Object.fromEntries(
      directory.page.items.map((item) => [item.handle, item.standing]),
    );
    expect(standings).toMatchObject({ ayla: 'restricted', bram: 'banned', cleo: 'good' });

    const restricted = await loadMemberDirectory(kit.as(founder), { standing: 'restricted' });
    expect(restricted.page.items.map((item) => item.handle)).toEqual(['ayla']);
  });

  it('BREAK: a plain member never sees standing and cannot filter by it', async () => {
    const viewer = await seedMember('viewer', { roles: ['verified'] });
    await seedMember('ayla', { standing: 'restricted' });
    await seedMember('quinn', { standing: 'quarantined' });

    const directory = await loadMemberDirectory(kit.as(viewer), { sort: 'name' });
    expect(directory.staffView).toBe(false);
    expect(directory.page.items.map((item) => item.handle)).toEqual(['ayla', 'quinn', 'viewer']);
    expect(directory.page.items.every((item) => item.standing === null)).toBe(true);

    // The filter is ignored rather than applied: it would otherwise reveal who is under action.
    const probe = await loadMemberDirectory(kit.as(viewer), { standing: 'restricted' });
    expect(probe.page.total).toBe(3);
  });

  it('BREAK: a plain member does not list banned members or staff-only profiles', async () => {
    const viewer = await seedMember('viewer', { roles: ['verified'] });
    await seedMember('open', { visibility: 'public' });
    await seedMember('guild', { visibility: 'members' });
    await seedMember('hidden', { visibility: 'staff' });
    await seedMember('bram', { standing: 'banned', visibility: 'public' });

    const directory = await loadMemberDirectory(kit.as(viewer), { sort: 'name' });
    expect(directory.page.items.map((item) => item.handle)).toEqual(['guild', 'open', 'viewer']);
    expect(directory.page.total).toBe(3);
    const hidden = await loadMemberDirectory(kit.as(viewer), { search: 'hidden' });
    expect(hidden.page.total).toBe(0);
  });

  it('keeps the viewer’s own row even when their profile is staff-only', async () => {
    const viewer = await seedMember('private-me', { visibility: 'staff', roles: ['verified'] });
    const directory = await loadMemberDirectory(kit.as(viewer), {});
    expect(directory.page.items.map((item) => item.id)).toEqual([viewer.memberId]);
  });

  it('matches core listMembers for visible members: search, role, status, sort, paging', async () => {
    const founder = await kit.member({ roles: ['founder'] });
    const viewer = await seedMember('viewer', { roles: ['verified'] });
    await seedMember('alpha', { roles: ['trial'] });
    await seedMember('alpine', { roles: ['verified'] });
    await seedMember('beta');
    await kit.db.update(members).set({ guildStatus: 'departed' }).where(eq(members.handle, 'beta'));

    const queries = [
      { search: 'alp', sort: 'name' as const },
      { role: 'verified' as const, sort: 'name' as const },
      { guildStatus: 'departed' as const },
      { sort: 'joined_asc' as const, limit: 2, offset: 1 },
    ];
    for (const query of queries) {
      const staff = await listMembers(kit.as(founder), query);
      const visible = await loadMemberDirectory(kit.as(viewer), query);
      const strip = (items: { id: string; roles: string[] }[]) =>
        items.map((item) => ({ id: item.id, roles: [...item.roles].sort() }));
      // The founder row is visible to both (default 'members' visibility, good standing).
      expect(strip(visible.page.items)).toEqual(strip(staff.items));
      expect(visible.page.total).toBe(staff.total);
    }
  });

  it('BREAK: an applicant without canViewMembers is refused', async () => {
    const applicant = await kit.member({ roles: ['applicant'] });
    await expect(loadMemberDirectory(kit.as(applicant), {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
