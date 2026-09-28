import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { members, projectMembers, projects } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { getProfile } from '../identity/profile.service';
import { ForbiddenError, InvalidStateError, NotFoundError } from '../kernel/errors';
import type { UserActor } from '../permissions/actor';
import {
  addProjectMember,
  addProjectMemberByHandle,
  changeProjectStatus,
  createProject,
  leaveProject,
  listAddableProjects,
} from './index';
import {
  DB_HOOK_TIMEOUT_MS,
  DB_TEST_TIMEOUT_MS,
  WARM_UP_TIMEOUT_MS,
  warmTestDatabase,
} from './testing/warm-up';

beforeAll(warmTestDatabase, WARM_UP_TIMEOUT_MS);

/** More projects than one small picker page holds. */
const BUSY_PROJECTS = 4;
const PICKER = 3;
const MINUTE_MS = 60_000;

describe('team lookups', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let kit: TestKit;
  let owner: UserActor;
  let jun: UserActor;
  let staff: UserActor;

  beforeEach(async () => {
    kit = await createTestKit();
    owner = await kit.member({ username: 'owner' });
    jun = await kit.member({ username: 'jun' });
    staff = await kit.member({ roles: ['operations'], username: 'steward' });
  }, DB_HOOK_TIMEOUT_MS);
  afterEach(async () => {
    await kit.close();
  });

  async function handleOf(actor: UserActor): Promise<string> {
    const [row] = await kit.db
      .select({ handle: members.handle })
      .from(members)
      .where(eq(members.id, actor.memberId!));
    return row!.handle;
  }

  /**
   * Projects owned by someone else, each with `on` as a contributor, all
   * updated after everything created so far (they sort first).
   */
  async function busyProjects(on: UserActor[], count = BUSY_PROJECTS): Promise<string[]> {
    const host = await kit.member();
    const later = new Date(kit.clock.now().getTime() + MINUTE_MS);
    const rows = await kit.db
      .insert(projects)
      .values(
        Array.from({ length: count }, (_, i) => ({
          slug: `busy-${host.memberId!.slice(0, 8)}-${i}`,
          title: `Busy ${i}`,
          ownerMemberId: host.memberId!,
          visibility: 'members' as const,
          status: 'building' as const,
          createdAt: later,
          updatedAt: later,
        })),
      )
      .returning({ id: projects.id });
    const joinedAt = kit.clock.now();
    await kit.db.insert(projectMembers).values(
      rows.flatMap(({ id }) => [
        { projectId: id, memberId: host.memberId!, role: 'owner' as const, joinedAt },
        ...on.map((actor) => ({
          projectId: id,
          memberId: actor.memberId!,
          role: 'contributor' as const,
          joinedAt,
        })),
      ]),
    );
    return rows.map((row) => row.id);
  }

  describe('listAddableProjects', () => {
    it('filters before limiting: an older managed project is offered past busier ones', async () => {
      const owned = await createProject(kit.as(owner), { title: 'Quiet Lab' });
      // The owner contributes to (and jun is on) more recently updated projects.
      await busyProjects([owner, jun]);
      const offered = await listAddableProjects(kit.as(owner), {
        memberId: jun.memberId!,
        limit: PICKER,
      });
      expect(offered.map((project) => project.id)).toEqual([owned.id]);
    });

    it('staff see every project the member is not on, even behind a full page of theirs', async () => {
      const older = await createProject(kit.as(owner), { title: 'Older Lab' });
      const busy = await busyProjects([jun]);
      const offered = await listAddableProjects(kit.as(staff), {
        memberId: jun.memberId!,
        limit: PICKER,
      });
      expect(offered.map((project) => project.id)).toEqual([older.id]);
      expect(offered.map((project) => project.id)).not.toEqual(expect.arrayContaining(busy));
    });

    it('excludes archived projects and current memberships; a former member is offered again', async () => {
      const kept = await createProject(kit.as(owner), { title: 'Kept' });
      const archived = await createProject(kit.as(owner), { title: 'Shelved' });
      const joined = await createProject(kit.as(owner), { title: 'Joined' });
      const left = await createProject(kit.as(owner), { title: 'Left' });
      await changeProjectStatus(kit.as(owner), { projectId: archived.id, status: 'archived' });
      for (const project of [joined, left]) {
        await addProjectMember(kit.as(owner), { projectId: project.id, memberId: jun.memberId! });
      }
      await leaveProject(kit.as(jun), { projectId: left.id });
      const offered = await listAddableProjects(kit.as(owner), { memberId: jun.memberId! });
      expect(offered.map((project) => project.id).sort()).toEqual([kept.id, left.id].sort());
    });

    it('BREAK: contributors, outsiders and members out of good standing manage nothing', async () => {
      const project = await createProject(kit.as(owner), {
        title: 'Open Lab',
        visibility: 'public',
      });
      await addProjectMember(kit.as(owner), { projectId: project.id, memberId: jun.memberId! });
      const outsider = await kit.member();
      expect(await listAddableProjects(kit.as(jun), { memberId: outsider.memberId! })).toHaveLength(
        0,
      );
      expect(
        await listAddableProjects(kit.as(outsider), { memberId: staff.memberId! }),
      ).toHaveLength(0);
      await kit.db
        .update(members)
        .set({ standing: 'quarantined' })
        .where(eq(members.id, owner.memberId!));
      const quarantined = { ...owner, standing: 'quarantined' as const };
      expect(
        await listAddableProjects(kit.as(quarantined), { memberId: outsider.memberId! }),
      ).toHaveLength(0);
    });
  });

  describe('addProjectMemberByHandle', () => {
    it('adds a member whose profile is staff-only, by handle in any case', async () => {
      const project = await createProject(kit.as(owner), { title: 'Rocket Engine' });
      await kit.db
        .update(members)
        .set({ profileVisibility: 'staff' })
        .where(eq(members.id, jun.memberId!));
      const handle = await handleOf(jun);
      // The profile itself stays private to the owner…
      await expect(getProfile(kit.as(owner), { handle })).rejects.toBeInstanceOf(NotFoundError);
      // …but adding by handle works, as it does from Discord.
      const row = await addProjectMemberByHandle(kit.as(owner), {
        projectId: project.id,
        handle: ` @${handle.toUpperCase()} `,
        role: 'maintainer',
      });
      expect(row).toMatchObject({ memberId: jun.memberId, role: 'maintainer' });
    });

    it('BREAK: unknown, malformed and banned handles all read as "Member not found"', async () => {
      const project = await createProject(kit.as(owner), { title: 'Rocket Engine' });
      await kit.db.update(members).set({ standing: 'banned' }).where(eq(members.id, jun.memberId!));
      const add = (actor: UserActor, handle: string) =>
        addProjectMemberByHandle(kit.as(actor), { projectId: project.id, handle });
      for (const handle of ['nobody-here', 'not a handle', '', await handleOf(jun)]) {
        await expect(add(owner, handle), handle).rejects.toBeInstanceOf(NotFoundError);
      }
      // Staff may see standing, so they get the real reason.
      await expect(add(staff, await handleOf(jun))).rejects.toBeInstanceOf(InvalidStateError);
    });

    it('BREAK: the manage check runs before the handle is resolved (no directory oracle)', async () => {
      const project = await createProject(kit.as(owner), {
        title: 'Open Lab',
        visibility: 'public',
      });
      const outsider = await kit.member();
      for (const handle of [await handleOf(jun), 'nobody-here']) {
        await expect(
          addProjectMemberByHandle(kit.as(outsider), { projectId: project.id, handle }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
      await addProjectMember(kit.as(owner), {
        projectId: project.id,
        memberId: jun.memberId!,
        role: 'maintainer',
      });
      await expect(
        addProjectMemberByHandle(kit.as(jun), {
          projectId: project.id,
          handle: await handleOf(outsider),
          role: 'maintainer',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const active = await kit.db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, project.id), isNull(projectMembers.leftAt)));
      expect(active).toHaveLength(2);
    });
  });
});
