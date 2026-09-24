import { and, eq } from 'drizzle-orm';
import {
  achievementDefinitions,
  contributions,
  memberAchievements,
  projectMembers,
  projects,
  serverSettings,
  trialResults,
  trials,
} from '@jave/database';
import type { TestKit } from '../../testing';

/**
 * Test-only rows for tables owned by other modules. Written directly so the
 * verification tests do not depend on those modules' services.
 */

let sequence = 0;
const next = () => ++sequence;

export async function createProject(
  kit: TestKit,
  ownerMemberId: string,
  options: { title?: string } = {},
): Promise<{ projectId: string }> {
  const n = next();
  const [project] = await kit.db
    .insert(projects)
    .values({
      slug: `project-${n}`,
      title: options.title ?? `Project ${n}`,
      ownerMemberId,
    })
    .returning({ id: projects.id });
  await kit.db
    .insert(projectMembers)
    .values({ projectId: project!.id, memberId: ownerMemberId, role: 'owner' });
  return { projectId: project!.id };
}

export async function addProjectMember(
  kit: TestKit,
  projectId: string,
  memberId: string,
  role: 'maintainer' | 'contributor' = 'contributor',
): Promise<void> {
  await kit.db.insert(projectMembers).values({ projectId, memberId, role });
}

export async function leaveProject(
  kit: TestKit,
  projectId: string,
  memberId: string,
): Promise<void> {
  await kit.db
    .update(projectMembers)
    .set({ leftAt: kit.clock.now() })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.memberId, memberId)));
}

export async function createContribution(
  kit: TestKit,
  memberId: string,
  options: { status?: 'submitted' | 'verified' | 'rejected'; title?: string } = {},
): Promise<{ contributionId: string }> {
  const [row] = await kit.db
    .insert(contributions)
    .values({
      memberId,
      kind: 'code',
      title: options.title ?? `Contribution ${next()}`,
      status: options.status ?? 'submitted',
    })
    .returning({ id: contributions.id });
  return { contributionId: row!.id };
}

export async function createMemberAchievement(
  kit: TestKit,
  memberId: string,
  options: { revoked?: boolean } = {},
): Promise<{ memberAchievementId: string }> {
  const key = `builder_${next()}`;
  await kit.db.insert(achievementDefinitions).values({
    key,
    title: 'BUILDER',
    description: '3 projects shipped.',
    category: 'projects',
    criteria: { type: 'manual' },
  });
  const [row] = await kit.db
    .insert(memberAchievements)
    .values({
      memberId,
      achievementKey: key,
      revokedAt: options.revoked ? kit.clock.now() : null,
    })
    .returning({ id: memberAchievements.id });
  return { memberAchievementId: row!.id };
}

export async function createTrialResult(
  kit: TestKit,
  memberId: string,
  options: { published?: boolean; facetKey?: string | null } = {},
): Promise<{ trialResultId: string }> {
  const [trial] = await kit.db
    .insert(trials)
    .values({
      title: `Trial ${next()}`,
      category: 'build',
      brief: 'Ship something real in 48 hours.',
      rubric: [],
      durationMinutes: 60,
      status: 'completed',
    })
    .returning({ id: trials.id });
  const [row] = await kit.db
    .insert(trialResults)
    .values({
      trialId: trial!.id,
      memberId,
      outcome: 'pass',
      finalScore: 7.5,
      facetKey: options.facetKey === undefined ? 'create.technical' : options.facetKey,
      publishedAt: options.published === false ? null : kit.clock.now(),
    })
    .returning({ id: trialResults.id });
  return { trialResultId: row!.id };
}

/** Configure the staff queue channel so queue-card jobs are enqueued. */
export async function enableQueueChannel(kit: TestKit, channelId = '123456789012345678') {
  await kit.db
    .insert(serverSettings)
    .values({ section: 'channels', value: { verificationQueue: channelId } })
    .onConflictDoUpdate({
      target: serverSettings.section,
      set: { value: { verificationQueue: channelId } },
    });
  kit.cache.delete('settings:channels');
  return channelId;
}
