import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectMembers, projects as projectsTable } from '@jave/database';
import { projects, type UserActor } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import { PICKER_LIMIT } from './constants';
import { selectValues } from './testing';

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

/** One more than a picker holds, so a truncate-then-filter picker would come up empty. */
const BUSY_PROJECTS = PICKER_LIMIT + 1;
const MINUTE_MS = 60_000;

describe('Add to Project picker', () => {
  let bot: BotHarness;
  let owner: Person;
  let jun: Person;

  beforeEach(async () => {
    bot = await createBotHarness({ config: { publicUrl: 'https://jave.test' } });
    owner = await bot.member({ roles: ['verified'], username: 'mara' });
    jun = await bot.member({ roles: ['verified'], username: 'jun' });
  });
  afterEach(async () => {
    await bot.close();
  });

  /** Projects hosted by someone else with `on` as contributors, updated after everything else. */
  async function busyProjects(on: Person[]): Promise<void> {
    const host = await bot.member({ roles: ['verified'] });
    const later = new Date(bot.kit.clock.now().getTime() + MINUTE_MS);
    const rows = await bot.kit.db
      .insert(projectsTable)
      .values(
        Array.from({ length: BUSY_PROJECTS }, (_, i) => ({
          slug: `busy-${i}`,
          title: `Busy ${i}`,
          ownerMemberId: host.actor.memberId!,
          visibility: 'members' as const,
          status: 'building' as const,
          createdAt: later,
          updatedAt: later,
        })),
      )
      .returning({ id: projectsTable.id });
    const joinedAt = bot.kit.clock.now();
    await bot.kit.db.insert(projectMembers).values(
      rows.flatMap(({ id }) => [
        { projectId: id, memberId: host.actor.memberId!, role: 'owner' as const, joinedAt },
        ...on.map((person) => ({
          projectId: id,
          memberId: person.actor.memberId!,
          role: 'contributor' as const,
          joinedAt,
        })),
      ]),
    );
  }

  const openMenu = (viewer: Person) =>
    bot.run({
      kind: 'user_context',
      name: 'Add to Project',
      user: viewer.user,
      targetUser: jun.user,
    });

  it('offers an owned project even when the owner contributes to more recently updated ones', async () => {
    const owned = await projects.createProject(bot.kit.as(owner.actor), { title: 'Quiet Lab' });
    await busyProjects([owner, jun]);
    const menu = await openMenu(owner);
    const select = customId('projects', 'addto', jun.actor.memberId!);
    expect(selectValues(menu.interaction.lastPayload(), select)).toEqual([owned.id]);
  });

  it('staff are offered older projects behind a full page the member is already on', async () => {
    const steward = await bot.member({ roles: ['operations'], username: 'steward' });
    const older = await projects.createProject(bot.kit.as(owner.actor), { title: 'Older Lab' });
    await busyProjects([jun]);
    const menu = await openMenu(steward);
    const select = customId('projects', 'addto', jun.actor.memberId!);
    expect(selectValues(menu.interaction.lastPayload(), select)).toEqual([older.id]);
  });

  it('says so plainly when nothing is left to add to', async () => {
    await busyProjects([owner, jun]);
    const menu = await openMenu(owner);
    expect(menu.interaction.lastText()).toContain('NO PROJECT TO ADD TO');
  });
});
