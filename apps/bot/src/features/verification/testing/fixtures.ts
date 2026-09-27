import {
  achievementDefinitions,
  contributions,
  memberAchievements,
  projectMembers,
  projects,
  trialResults,
  trials,
} from '@jave/database';
import type { TestKit } from '@jave/core/testing';

/**
 * TEST DATA ONLY — rows owned by other modules, written directly so the
 * verification surface tests do not depend on those modules' services.
 */

let sequence = 0;
const next = () => ++sequence;

export async function createProject(
  kit: TestKit,
  ownerMemberId: string,
  title = `Project ${next()}`,
): Promise<string> {
  const [project] = await kit.db
    .insert(projects)
    .values({ slug: `vp-${next()}-${Date.now()}`, title, ownerMemberId })
    .returning({ id: projects.id });
  await kit.db
    .insert(projectMembers)
    .values({ projectId: project!.id, memberId: ownerMemberId, role: 'owner' });
  return project!.id;
}

export async function createContribution(
  kit: TestKit,
  memberId: string,
  title = `Contribution ${next()}`,
): Promise<string> {
  const [row] = await kit.db
    .insert(contributions)
    .values({ memberId, kind: 'code', title, status: 'submitted' })
    .returning({ id: contributions.id });
  return row!.id;
}

export async function createMemberAchievement(kit: TestKit, memberId: string): Promise<string> {
  const key = `vbuilder_${next()}`;
  await kit.db.insert(achievementDefinitions).values({
    key,
    title: 'BUILDER',
    description: '3 projects shipped.',
    category: 'projects',
    criteria: { type: 'manual' },
  });
  const [row] = await kit.db
    .insert(memberAchievements)
    .values({ memberId, achievementKey: key })
    .returning({ id: memberAchievements.id });
  return row!.id;
}

export async function createTrialResult(kit: TestKit, memberId: string): Promise<string> {
  const [trial] = await kit.db
    .insert(trials)
    .values({
      title: `Cold-start build ${next()}`,
      category: 'build',
      brief: 'Ship something real in 48 hours.',
      rubric: [],
      status: 'completed',
      durationMinutes: 120,
    })
    .returning({ id: trials.id });
  const [row] = await kit.db
    .insert(trialResults)
    .values({
      trialId: trial!.id,
      memberId,
      outcome: 'pass',
      finalScore: 7.5,
      publishedAt: kit.clock.now(),
    })
    .returning({ id: trialResults.id });
  return row!.id;
}
