import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  members as membersTable,
  projectMembers,
  projectMilestones,
  projects as projectsTable,
} from '@jave/database';
import { projects } from '@jave/core';
import { createBotHarness, type BotHarness } from '../../testing/harness';
import { customId } from '../../interactions/custom-id';
import type { InteractionUser } from '../../interactions/types';
import type { UserActor } from '@jave/core';
import { buttonLabels, customIds, selectValues } from './testing';

interface Person {
  actor: UserActor;
  user: InteractionUser;
}

describe('projects feature', () => {
  let bot: BotHarness;
  let owner: Person;

  beforeEach(async () => {
    bot = await createBotHarness({ config: { publicUrl: 'https://jave.test' } });
    owner = await bot.member({ roles: ['verified'], username: 'mara' });
  });
  afterEach(async () => {
    await bot.close();
  });

  const createProject = (
    who: Person,
    input: Parameters<typeof projects.createProject>[1] = { title: 'Rocket Engine' },
  ) => projects.createProject(bot.kit.as(who.actor), input);

  describe('/project create', () => {
    it('opens the modal and the submission starts an IDEA project owned by the author', async () => {
      const opened = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'create',
        user: owner.user,
      });
      expect(opened.interaction.responses[0]?.type).toBe('modal');

      const submitted = await bot.run({
        kind: 'modal',
        name: customId('projects', 'create'),
        user: owner.user,
        modalText: { title: 'Rocket Engine', summary: 'Hybrid motor, 2 kN', description: '' },
        modalSelect: { visibility: ['public'], domain: ['create'] },
      });
      const text = submitted.interaction.lastText();
      expect(text).toContain('PROJECT STARTED');
      expect(text).toContain('ROCKET ENGINE');
      expect(text).toContain('**▸ IDEA**');
      const payload = submitted.interaction.lastPayload()!;
      expect(payload.ephemeral).toBe(true);
      expect(buttonLabels(payload)).toEqual(
        expect.arrayContaining(['STATUS', 'ADD MILESTONE', 'RECORD CONTRIBUTION']),
      );
      expect(buttonLabels(payload)).not.toContain('LEAVE');
      const [row] = await bot.kit.db.select().from(projectsTable);
      expect(row).toMatchObject({
        title: 'Rocket Engine',
        visibility: 'public',
        domainKey: 'create',
        ownerMemberId: owner.actor.memberId,
      });
    });

    it('BREAK: forged visibility and oversized titles are refused', async () => {
      const forged = await bot.run({
        kind: 'modal',
        name: customId('projects', 'create'),
        user: owner.user,
        modalText: { title: 'Rocket Engine' },
        modalSelect: { visibility: ['everyone'] },
      });
      expect(forged.interaction.lastText()).toContain('INVALID INPUT');
      const long = await bot.run({
        kind: 'modal',
        name: customId('projects', 'create'),
        user: owner.user,
        modalText: { title: 'x'.repeat(500) },
        modalSelect: { visibility: ['members'] },
      });
      expect(long.interaction.lastText()).toContain('INVALID INPUT');
      expect(await bot.kit.db.select().from(projectsTable)).toHaveLength(0);
    });

    it('BREAK: mention-shaped titles are neutralized on the card', async () => {
      await bot.run({
        kind: 'modal',
        name: customId('projects', 'create'),
        user: owner.user,
        modalText: { title: '@everyone **ship** <@123456789012345678>' },
        modalSelect: { visibility: ['members'] },
      });
      const [project] = await bot.kit.db.select().from(projectsTable);
      const view = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: project!.id },
      });
      const text = view.interaction.lastText();
      expect(text).not.toMatch(/@everyone/i);
      expect(text).not.toMatch(/<@\d+>/);
      expect(text).toContain('@\u200bEVERYONE');
    });
  });

  describe('/project view', () => {
    it('renders the pipeline, team, milestones and links', async () => {
      const project = await createProject(owner, {
        title: 'Rocket Engine',
        summary: 'Hybrid motor',
        visibility: 'public',
      });
      const ctx = bot.kit.as(owner.actor);
      await projects.changeProjectStatus(ctx, { projectId: project.id, status: 'building' });
      await projects.addMilestone(ctx, { projectId: project.id, title: 'Static fire' });
      await projects.addProjectLink(ctx, {
        projectId: project.id,
        label: 'Docs',
        url: 'https://docs.example.org/engine',
      });
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: project.id },
      });
      const text = interaction.lastText();
      expect(text).toContain('JVLN PROJECT');
      expect(text).toContain('IDEA → PLANNING → **▸ BUILDING** → TESTING → SHIPPED');
      expect(text).toContain('mara');
      expect(text).toContain('OWNER');
      expect(text).toContain('Static fire');
      expect(text).toContain('https://docs.example.org/engine');
      expect(interaction.lastPayload()!.components!.at(-1)!.components[0]).toMatchObject({
        url: `https://jave.test/projects/${project.slug}`,
      });
    });

    it('shares only public projects, and shared cards carry no personal controls', async () => {
      const open = await createProject(owner, { title: 'Open Engine', visibility: 'public' });
      const closed = await createProject(owner, { title: 'Closed Engine', visibility: 'members' });
      const shared = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: open.id, share: true },
      });
      expect(shared.interaction.lastPayload()!.ephemeral).toBe(false);
      expect(customIds(shared.interaction.lastPayload())).toEqual([]);
      const refused = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: closed.id, share: true },
      });
      expect(refused.interaction.lastPayload()!.ephemeral).toBe(true);
      expect(refused.interaction.lastText()).toContain('NOT SHARED');
    });

    it('BREAK: a shared card names only public profiles, never the sharer’s insider view', async () => {
      const open = await createProject(owner, { title: 'Open Engine', visibility: 'public' });
      const hidden = await bot.member({ roles: ['verified'], username: 'quietmate' });
      const visible = await bot.member({ roles: ['verified'], username: 'loudmate' });
      await bot.kit.db
        .update(membersTable)
        .set({ profileVisibility: 'staff' })
        .where(eq(membersTable.id, hidden.actor.memberId!));
      await bot.kit.db
        .update(membersTable)
        .set({ profileVisibility: 'public' })
        .where(eq(membersTable.id, visible.actor.memberId!));
      for (const teammate of [hidden, visible]) {
        await projects.addProjectMember(bot.kit.as(owner.actor), {
          projectId: open.id,
          memberId: teammate.actor.memberId!,
          role: 'contributor',
        });
      }
      const own = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: open.id },
      });
      expect(own.interaction.lastText()).toContain('quietmate');
      const shared = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: open.id, share: true },
      });
      const text = shared.interaction.lastText();
      expect(shared.interaction.lastPayload()!.ephemeral).toBe(false);
      expect(text).toContain('loudmate');
      expect(text).not.toContain('quietmate');
      // The owner's own profile is members-only: counted, not named, in public.
      expect(text).not.toContain('mara');
      expect(text).toContain('+2 more');
    });

    it('accepts a typed slug', async () => {
      const project = await createProject(owner);
      const { interaction } = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        options: { project: project.slug.toUpperCase() },
      });
      expect(interaction.lastText()).toContain('ROCKET ENGINE');
    });

    it('BREAK: private projects are invisible to outsiders (view, autocomplete, forged buttons)', async () => {
      const secret = await createProject(owner, { title: 'Stealth Drone', visibility: 'private' });
      const outsider = await bot.member({ roles: ['verified'] });
      const view = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'view',
        user: outsider.user,
        options: { project: secret.id },
      });
      expect(view.interaction.lastText()).toContain('NOT FOUND');
      const auto = await bot.run({
        kind: 'autocomplete',
        name: 'project',
        subcommand: 'view',
        user: outsider.user,
        focused: { name: 'project', value: 'stealth' },
      });
      expect(auto.interaction.responses[0]).toEqual({ type: 'autocomplete', choices: [] });
      const forged = await bot.run({
        kind: 'button',
        name: customId('projects', 'view', secret.id),
        user: outsider.user,
      });
      expect(forged.interaction.lastText()).toContain('NOT FOUND');
      const ownerAuto = await bot.run({
        kind: 'autocomplete',
        name: 'project',
        subcommand: 'view',
        user: owner.user,
        focused: { name: 'project', value: 'stealth' },
      });
      expect(ownerAuto.interaction.responses[0]).toMatchObject({
        choices: [{ name: 'Stealth Drone · IDEA', value: secret.id }],
      });
    });

    it('BREAK: malformed and unknown custom ids fail closed', async () => {
      const malformed = await bot.run({
        kind: 'button',
        name: customId('projects', 'view', 'not-a-uuid'),
        user: owner.user,
      });
      expect(malformed.interaction.lastText()).toContain('NOT FOUND');
      const unknown = await bot.run({
        kind: 'button',
        name: customId('projects', 'toString'),
        user: owner.user,
      });
      expect(unknown.interaction.lastText()).toContain('EXPIRED');
      const proto = await bot.run({
        kind: 'button',
        name: customId('projects', '__proto__'),
        user: owner.user,
      });
      expect(proto.interaction.lastText()).toContain('EXPIRED');
    });
  });

  describe('status pipeline', () => {
    it('moves a project through the pipeline with a select and ships it once', async () => {
      const project = await createProject(owner);
      const picker = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'status',
        user: owner.user,
        options: { project: project.id },
      });
      const statusSelect = customId('projects', 'setstatus', project.id, 'idea');
      expect(customIds(picker.interaction.lastPayload())).toEqual([statusSelect]);
      expect(selectValues(picker.interaction.lastPayload(), statusSelect)).toEqual([
        'planning',
        'building',
        'archived',
      ]);
      await bot.run({ kind: 'select', name: statusSelect, user: owner.user, values: ['building'] });
      const shipped = await bot.run({
        kind: 'select',
        name: customId('projects', 'setstatus', project.id, 'building'),
        user: owner.user,
        values: ['shipped'],
      });
      expect(shipped.interaction.responses[0]?.type).toBe('update');
      expect(shipped.interaction.lastText()).toContain('PROJECT SHIPPED');
      const [row] = await bot.kit.db
        .select()
        .from(projectsTable)
        .where(eq(projectsTable.id, project.id));
      expect(row!.status).toBe('shipped');
      expect(row!.shippedAt).not.toBeNull();
      await bot.drain();
    });

    it('BREAK: a stale select changes nothing', async () => {
      const project = await createProject(owner);
      await projects.changeProjectStatus(bot.kit.as(owner.actor), {
        projectId: project.id,
        status: 'planning',
      });
      const stale = await bot.run({
        kind: 'select',
        name: customId('projects', 'setstatus', project.id, 'idea'),
        user: owner.user,
        values: ['building'],
      });
      expect(stale.interaction.lastText()).toContain('STALE');
      const [row] = await bot.kit.db.select().from(projectsTable);
      expect(row!.status).toBe('planning');
    });

    it('BREAK: non-members pressing the status control are refused and audited', async () => {
      const project = await createProject(owner, { title: 'Rocket Engine', visibility: 'members' });
      const intruder = await bot.member({ roles: ['verified'] });
      const picker = await bot.run({
        kind: 'button',
        name: customId('projects', 'status', project.id),
        user: intruder.user,
      });
      expect(picker.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forged = await bot.run({
        kind: 'select',
        name: customId('projects', 'setstatus', project.id, 'idea'),
        user: intruder.user,
        values: ['building'],
      });
      expect(forged.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const [row] = await bot.kit.db.select().from(projectsTable);
      expect(row!.status).toBe('idea');
      const denials = await bot.kit.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.targetId, project.id)));
      expect(denials.length).toBeGreaterThan(0);
    });

    it('archiving needs owner rights and an explicit confirmation', async () => {
      const project = await createProject(owner);
      const maintainer = await bot.member({ roles: ['verified'] });
      await projects.addProjectMember(bot.kit.as(owner.actor), {
        projectId: project.id,
        memberId: maintainer.actor.memberId!,
        role: 'maintainer',
      });
      const maintainerPicker = await bot.run({
        kind: 'button',
        name: customId('projects', 'status', project.id),
        user: maintainer.user,
      });
      expect(
        selectValues(maintainerPicker.interaction.lastPayload(), 'projects:setstatus'),
      ).not.toContain('archived');
      const forgedArchive = await bot.run({
        kind: 'button',
        name: customId('projects', 'archive', project.id, 'idea'),
        user: maintainer.user,
      });
      expect(forgedArchive.interaction.lastText()).toContain('ACCESS RESTRICTED');

      const confirm = await bot.run({
        kind: 'select',
        name: customId('projects', 'setstatus', project.id, 'idea'),
        user: owner.user,
        values: ['archived'],
      });
      expect(confirm.interaction.lastText()).toContain('ARCHIVE PROJECT');
      let [row] = await bot.kit.db.select().from(projectsTable);
      expect(row!.status).toBe('idea');
      await bot.run({
        kind: 'button',
        name: customId('projects', 'archive', project.id, 'idea'),
        user: owner.user,
      });
      [row] = await bot.kit.db.select().from(projectsTable);
      expect(row!.status).toBe('archived');
      const frozen = await bot.run({
        kind: 'button',
        name: customId('projects', 'status', project.id),
        user: owner.user,
      });
      expect(frozen.interaction.lastText()).toContain('ARCHIVED');
    });
  });

  describe('milestones', () => {
    it('adds a milestone through the modal and completes it from a select', async () => {
      const project = await createProject(owner);
      const opened = await bot.run({
        kind: 'button',
        name: customId('projects', 'msadd', project.id),
        user: owner.user,
      });
      expect(opened.interaction.responses[0]?.type).toBe('modal');
      const added = await bot.run({
        kind: 'modal',
        name: customId('projects', 'msadd', project.id),
        user: owner.user,
        modalText: { title: 'Static fire', description: 'Full duration', dueDate: '2026-04-01' },
      });
      expect(added.interaction.lastText()).toContain('MILESTONE ADDED');
      const [milestone] = await bot.kit.db.select().from(projectMilestones);
      expect(milestone!.dueAt?.toISOString()).toBe('2026-04-01T00:00:00.000Z');

      const picker = await bot.run({
        kind: 'button',
        name: customId('projects', 'msdone', project.id),
        user: owner.user,
      });
      expect(selectValues(picker.interaction.lastPayload(), 'projects:msdonesel')).toEqual([
        milestone!.id,
      ]);
      const done = await bot.run({
        kind: 'select',
        name: customId('projects', 'msdonesel', project.id),
        user: owner.user,
        values: [milestone!.id],
      });
      expect(done.interaction.lastText()).toContain('MILESTONE DONE');
      const [after] = await bot.kit.db.select().from(projectMilestones);
      expect(after!.status).toBe('done');
    });

    it('/project milestone done autocompletes open milestones of that project only', async () => {
      const project = await createProject(owner);
      const other = await createProject(owner, { title: 'Other' });
      const ctx = bot.kit.as(owner.actor);
      const m1 = await projects.addMilestone(ctx, { projectId: project.id, title: 'Static fire' });
      await projects.addMilestone(ctx, { projectId: other.id, title: 'Unrelated' });
      const auto = await bot.run({
        kind: 'autocomplete',
        name: 'project',
        subcommandGroup: 'milestone',
        subcommand: 'done',
        user: owner.user,
        options: { project: project.id },
        focused: { name: 'milestone', value: '' },
      });
      expect(auto.interaction.responses[0]).toMatchObject({
        choices: [{ name: 'Static fire · PLANNED', value: m1.id }],
      });
      const done = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommandGroup: 'milestone',
        subcommand: 'done',
        user: owner.user,
        options: { project: project.id, milestone: m1.id },
      });
      expect(done.interaction.lastText()).toContain('MILESTONE DONE');
    });

    it('BREAK: bad dates, foreign milestones and outsiders are refused', async () => {
      const project = await createProject(owner);
      const other = await createProject(owner, { title: 'Other' });
      const foreign = await projects.addMilestone(bot.kit.as(owner.actor), {
        projectId: other.id,
        title: 'Foreign',
      });
      const badDate = await bot.run({
        kind: 'modal',
        name: customId('projects', 'msadd', project.id),
        user: owner.user,
        modalText: { title: 'Static fire', dueDate: '2026-02-30' },
      });
      expect(badDate.interaction.lastText()).toContain('YYYY-MM-DD');
      const idor = await bot.run({
        kind: 'select',
        name: customId('projects', 'msdonesel', project.id),
        user: owner.user,
        values: [foreign.id],
      });
      expect(idor.interaction.lastText()).toContain('NOT FOUND');
      const typed = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommandGroup: 'milestone',
        subcommand: 'done',
        user: owner.user,
        options: { project: project.id, milestone: 'Foreign' },
      });
      expect(typed.interaction.lastText()).toContain('NOT FOUND');
      const foreignBySlash = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommandGroup: 'milestone',
        subcommand: 'done',
        user: owner.user,
        options: { project: project.id, milestone: foreign.id },
      });
      expect(foreignBySlash.interaction.lastText()).toContain('NOT FOUND');
      const outsider = await bot.member({ roles: ['verified'] });
      const blocked = await bot.run({
        kind: 'button',
        name: customId('projects', 'msadd', project.id),
        user: outsider.user,
      });
      expect(blocked.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedModal = await bot.run({
        kind: 'modal',
        name: customId('projects', 'msadd', project.id),
        user: outsider.user,
        modalText: { title: 'Sneaky' },
      });
      expect(forgedModal.interaction.lastText()).toContain('ACCESS RESTRICTED');
      expect(await bot.kit.db.select().from(projectMilestones)).toHaveLength(1);
    });
  });

  describe('team', () => {
    it('adds and removes members with /project member', async () => {
      const project = await createProject(owner);
      const jun = await bot.member({ roles: ['verified'], username: 'jun' });
      const added = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommandGroup: 'member',
        subcommand: 'add',
        user: owner.user,
        options: { project: project.id, member: jun.user, role: 'maintainer' },
      });
      expect(added.interaction.lastText()).toContain('MEMBER ADDED');
      expect(added.interaction.lastText()).toContain('MAINTAINER');
      const removed = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommandGroup: 'member',
        subcommand: 'remove',
        user: owner.user,
        options: { project: project.id, member: jun.user },
      });
      expect(removed.interaction.lastText()).toContain('MEMBER REMOVED');
      await bot.drain();
    });

    it('ADD MEMBER: card → member picker → role, re-authorized at every step', async () => {
      const project = await createProject(owner);
      const jun = await bot.member({ roles: ['verified'], username: 'jun' });
      const card = await bot.run({
        kind: 'button',
        name: customId('projects', 'view', project.id),
        user: owner.user,
      });
      const open = customId('projects', 'addmember', project.id);
      expect(customIds(card.interaction.lastPayload())).toContain(open);
      // Every row stays within Discord's five-button limit.
      for (const row of card.interaction.lastPayload()!.components!)
        expect(row.components.length).toBeLessThanOrEqual(5);
      const picker = await bot.run({ kind: 'button', name: open, user: owner.user });
      const pick = customId('projects', 'addpick', project.id);
      expect(customIds(picker.interaction.lastPayload())).toEqual([pick]);
      const roles = await bot.run({
        kind: 'select',
        name: pick,
        user: owner.user,
        values: [jun.user.id],
      });
      expect(buttonLabels(roles.interaction.lastPayload())).toEqual(['CONTRIBUTOR', 'MAINTAINER']);
      const done = await bot.run({
        kind: 'button',
        name: customId('projects', 'add', project.id, jun.actor.memberId!, 'contributor'),
        user: owner.user,
      });
      expect(done.interaction.lastText()).toContain('MEMBER ADDED');
      const rows = await bot.kit.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.memberId, jun.actor.memberId!));
      expect(rows[0]!.role).toBe('contributor');

      const again = await bot.run({
        kind: 'select',
        name: pick,
        user: owner.user,
        values: [jun.user.id],
      });
      expect(again.interaction.lastText()).toContain('ALREADY ON THE TEAM');
    });

    it('BREAK: the member picker refuses outsiders, unknown users and forged values', async () => {
      const project = await createProject(owner);
      const outsider = await bot.member({ roles: ['verified'] });
      const jun = await bot.member({ roles: ['verified'] });
      const pick = customId('projects', 'addpick', project.id);
      const byOutsider = await bot.run({
        kind: 'button',
        name: customId('projects', 'addmember', project.id),
        user: outsider.user,
      });
      expect(byOutsider.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const forgedPick = await bot.run({
        kind: 'select',
        name: pick,
        user: outsider.user,
        values: [jun.user.id],
      });
      expect(forgedPick.interaction.lastText()).toContain('ACCESS RESTRICTED');
      for (const value of ['123456789012345678', '@everyone', '']) {
        const refused = await bot.run({
          kind: 'select',
          name: pick,
          user: owner.user,
          values: [value],
        });
        expect(refused.interaction.lastText(), value).toContain('NOT FOUND');
      }
      const maintainer = await bot.member({ roles: ['verified'] });
      await projects.addProjectMember(bot.kit.as(owner.actor), {
        projectId: project.id,
        memberId: maintainer.actor.memberId!,
        role: 'maintainer',
      });
      const offered = await bot.run({
        kind: 'select',
        name: pick,
        user: maintainer.user,
        values: [jun.user.id],
      });
      expect(buttonLabels(offered.interaction.lastPayload())).toEqual(['CONTRIBUTOR']);
      const members = await bot.kit.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.memberId, jun.actor.memberId!));
      expect(members).toHaveLength(0);
    });

    it('BREAK: forged add buttons are re-authorized (outsiders, maintainers granting maintainer)', async () => {
      const project = await createProject(owner);
      const maintainer = await bot.member({ roles: ['verified'] });
      await projects.addProjectMember(bot.kit.as(owner.actor), {
        projectId: project.id,
        memberId: maintainer.actor.memberId!,
        role: 'maintainer',
      });
      const target = await bot.member({ roles: ['verified'] });
      const outsider = await bot.member({ roles: ['verified'] });
      const byOutsider = await bot.run({
        kind: 'button',
        name: customId('projects', 'add', project.id, target.actor.memberId!, 'contributor'),
        user: outsider.user,
      });
      expect(byOutsider.interaction.lastText()).toContain('ACCESS RESTRICTED');
      const escalate = await bot.run({
        kind: 'button',
        name: customId('projects', 'add', project.id, target.actor.memberId!, 'maintainer'),
        user: maintainer.user,
      });
      expect(escalate.interaction.lastText()).toContain('Maintainers can only manage contributors');
      const owners = await bot.run({
        kind: 'button',
        name: customId('projects', 'add', project.id, target.actor.memberId!, 'owner'),
        user: owner.user,
      });
      expect(owners.interaction.lastText()).toContain('INVALID INPUT');
      const members = await bot.kit.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.memberId, target.actor.memberId!));
      expect(members).toHaveLength(0);
    });

    it('leaving asks for confirmation; owners must transfer first', async () => {
      const project = await createProject(owner);
      const jun = await bot.member({ roles: ['verified'] });
      await projects.addProjectMember(bot.kit.as(owner.actor), {
        projectId: project.id,
        memberId: jun.actor.memberId!,
      });
      const card = await bot.run({
        kind: 'button',
        name: customId('projects', 'view', project.id),
        user: jun.user,
      });
      expect(buttonLabels(card.interaction.lastPayload())).toContain('LEAVE');
      const confirm = await bot.run({
        kind: 'button',
        name: customId('projects', 'leave', project.id),
        user: jun.user,
      });
      expect(confirm.interaction.lastText()).toContain('LEAVE PROJECT');
      const left = await bot.run({
        kind: 'button',
        name: customId('projects', 'leaveok', project.id),
        user: jun.user,
      });
      expect(left.interaction.lastText()).toContain('LEFT PROJECT');
      const ownerLeaves = await bot.run({
        kind: 'button',
        name: customId('projects', 'leaveok', project.id),
        user: owner.user,
      });
      expect(ownerLeaves.interaction.lastText()).toContain('Transfer ownership');
    });
  });

  describe('/project list', () => {
    it('lists, filters by status and pages', async () => {
      for (let i = 1; i <= 5; i++) await createProject(owner, { title: `Engine ${i}` });
      const colleague = await bot.member({ roles: ['verified'] });
      for (let i = 1; i <= 5; i++) await createProject(colleague, { title: `Probe ${i}` });
      const [first] = await bot.kit.db.select().from(projectsTable).limit(1);
      await projects.changeProjectStatus(bot.kit.as(owner.actor), {
        projectId: first!.id,
        status: 'building',
      });
      const third = await bot.member({ roles: ['verified'] });
      await createProject(third, { title: 'Probe extra' });

      const list = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'list',
        user: owner.user,
      });
      expect(list.interaction.lastText()).toContain('PROJECTS · ALL ACTIVE');
      expect(list.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('11 total');
      const next = customId('projects', 'list', 'all', 'any', 10);
      expect(customIds(list.interaction.lastPayload())).toContain(next);
      const page2 = await bot.run({ kind: 'button', name: next, user: owner.user });
      expect(page2.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('page 2/2');

      const filtered = await bot.run({
        kind: 'select',
        name: customId('projects', 'filter', 'all'),
        user: owner.user,
        values: ['building'],
      });
      expect(filtered.interaction.lastText()).toContain('BUILDING');
      expect(filtered.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('1 total');

      const mine = await bot.run({
        kind: 'slash',
        name: 'project',
        subcommand: 'list',
        user: owner.user,
        options: { mine: true },
      });
      expect(mine.interaction.lastText()).toContain('YOUR PROJECTS');
      expect(mine.interaction.lastPayload()!.embeds![0]!.footer!.text).toContain('5 total');

      const open = await bot.run({
        kind: 'select',
        name: customId('projects', 'open'),
        user: owner.user,
        values: [first!.id],
      });
      expect(open.interaction.lastText()).toContain('JVLN PROJECT');
    });
  });
});
