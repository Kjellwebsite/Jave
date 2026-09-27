import { claimRank, setVerifiedRank } from '../../identity/capabilities.service';
import { completeOnboarding, updateProfile } from '../../identity/profile.service';
import { grantRole } from '../../identity/roles.service';
import { recordGuildJoin } from '../../identity/users.service';
import type { OrgRole } from '../../permissions/roles';
import { type CastKey, castMember, type FacetKey, type RankCode } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/** A member arrives through the gateway path the bot uses (guildMemberAdd). */
export async function join(run: SeedRun, key: CastKey): Promise<void> {
  const cast = castMember(key);
  const { user, member } = await recordGuildJoin(run.systemContext('gateway: member joined'), {
    discordId: cast.discordId,
    username: cast.username,
    displayName: cast.displayName,
  });
  run.register({ key, userId: user.id, memberId: member.id, discordId: cast.discordId });
  if (!cast.onboarded) return;

  await run.later(run.rng.int(3, 40));
  const self = await run.as(key);
  await completeOnboarding(self, {
    displayName: cast.displayName,
    headline: cast.headline,
    primaryDomain: cast.primaryDomain,
    profileVisibility: cast.visibility,
  });
  await updateProfile(self, member.id, {
    bio: cast.bio,
    showClaimsPublicly: cast.visibility === 'public',
  });
  for (const [facetKey, rank] of Object.entries(cast.claims)) {
    await run.later(run.rng.int(1, 20));
    await claimRank(await run.as(key), { facetKey, rank });
  }
}

/** A staff member grants a role through the authorized service (hierarchy enforced). */
export async function grant(
  run: SeedRun,
  by: CastKey,
  to: CastKey,
  role: OrgRole,
  reason: string,
): Promise<void> {
  await grantRole(await run.as(by), { memberId: run.person(to).memberId, role, reason });
}

/** An evaluator verifies a rank (never their own). */
export async function verifyRank(
  run: SeedRun,
  evaluator: CastKey,
  subject: CastKey,
  facetKey: FacetKey,
  rank: RankCode,
  reason: string,
): Promise<void> {
  await setVerifiedRank(await run.as(evaluator), {
    memberId: run.person(subject).memberId,
    facetKey,
    rank,
    reason,
  });
}

const FOUNDING_REVIEW_REASON =
  'Founding review: portfolio, references and a live walkthrough of shipped work.';

/** Join, then a role from someone above (founding staff and cohort). */
function appoint(story: Story, day: number, hour: number, key: CastKey, by: CastKey, role: OrgRole, reason: string) {
  story.at(day, hour, async (run) => {
    await join(run, key);
    await grant(run, by, key, role, reason);
  });
}

/**
 * Chapter 1 (150–120 days ago): the founder bootstraps JAVELIN, appoints the
 * staff, admits a founding cohort and verifies its ranks against evidence.
 */
export function foundOrganization(story: Story): void {
  story.at(-150, 9, (run) => join(run, 'founder'));
  appoint(story, -148, 10, 'core', 'founder', 'core', 'Founding core team.');
  appoint(story, -146, 14, 'kai', 'founder', 'core', 'Founding core team: security and infrastructure.');
  appoint(story, -145, 11, 'mara', 'founder', 'verified', 'Founding cohort, admitted on evidence.');
  appoint(story, -144, 11, 'sana', 'founder', 'verified', 'Founding cohort, admitted on evidence.');
  appoint(story, -142, 11, 'aiko', 'founder', 'verified', 'Founding cohort, admitted on evidence.');
  appoint(story, -140, 9, 'operations', 'core', 'operations', 'Runs trials, missions and events.');
  appoint(story, -138, 16, 'theo', 'core', 'operations', 'Trial design and evaluation.');

  story.at(-136, 10, async (run) => {
    for (const key of ['mara', 'sana', 'aiko'] as const) {
      for (const [facetKey, rank] of Object.entries(castMember(key).verified)) {
        await run.later(run.rng.int(5, 45));
        await verifyRank(
          run,
          run.rng.pick(['core', 'kai'] as const),
          key,
          facetKey as FacetKey,
          rank,
          FOUNDING_REVIEW_REASON,
        );
      }
    }
    await verifyRank(
      run,
      'kai',
      'founder',
      'life.execution',
      'A',
      'Built and ran two student organizations to 200+ members; verified through references.',
    );
    await verifyRank(
      run,
      'founder',
      'kai',
      'create.technical',
      'A',
      'Incident record and infrastructure repositories reviewed.',
    );
    await verifyRank(
      run,
      'founder',
      'core',
      'mind.reasoning',
      'A',
      'Evaluation write-ups reviewed; consistent, well-calibrated judgement.',
    );
  });

  appoint(story, -132, 15, 'moderator', 'core', 'moderator', 'Safety and ticket desk.');
  appoint(story, -128, 12, 'rhea', 'kai', 'moderator', 'Safety and member support.');
  appoint(story, -120, 18, 'iris', 'founder', 'supporter', 'Patron: funds the hardware budget.');
}
