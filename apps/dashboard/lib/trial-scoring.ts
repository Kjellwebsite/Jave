import type { trials } from '@jave/core';

/** Something the viewer may score: `team:<id>` or `member:<id>`. */
export interface ScoreTarget {
  value: string;
  label: string;
  /** The viewer's earlier evaluation of this target, if any. */
  previous: { scores: Record<string, number>; notes: string | null } | null;
}

type ScoredTeam = Pick<trials.StaffTeamView, 'id' | 'name' | 'members' | 'submissions'> & {
  evaluations: readonly Pick<
    trials.StaffEvaluationView,
    'evaluatorUserId' | 'memberId' | 'scores' | 'notes'
  >[];
};

/**
 * What the viewer may score on one team, mirroring the trials service: nothing
 * when the team never submitted (its result is INCOMPLETE; the service refuses
 * the team and each of its members alike), and never the viewer themselves.
 * The service enforces both again.
 */
export function scoreTargets(
  team: ScoredTeam,
  viewer: { userId: string; memberId: string | null },
): ScoreTarget[] {
  if (team.submissions.length === 0) return [];
  const previous = (memberId: string | null): ScoreTarget['previous'] => {
    const mine = team.evaluations.find(
      (evaluation) =>
        evaluation.evaluatorUserId === viewer.userId && evaluation.memberId === memberId,
    );
    return mine ? { scores: mine.scores, notes: mine.notes } : null;
  };
  return [
    { value: `team:${team.id}`, label: `${team.name} — team`, previous: previous(null) },
    ...team.members
      .filter((member) => member.memberId !== viewer.memberId)
      .map((member) => ({
        value: `member:${member.memberId}`,
        label: `${member.displayName} — individual`,
        previous: previous(member.memberId),
      })),
  ];
}
