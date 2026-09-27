import { activeRoles } from '../../identity/users.service';
import * as trials from '../../trials';
import { leadPriority } from '../../trials/guards';
import { type CastKey, castMember } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';
import { grant } from './people';

/**
 * Trials: a completed 48-Hour Ship (teams, versions, team and individual
 * evaluations, published results, rank consequences, promotions), an active
 * evidence sprint mid-flight, and a strategy trial recruiting.
 *
 * Every run tells the same story: the rosters are dealt from a seed searched
 * for them (see `assignmentSeed`), and criterion scores vary around exact
 * targets, so who passes, fails or earns a distinction never depends on the
 * random draw.
 */

const SCORE_FLOOR = 0;
const SCORE_CEILING = 10;
/** How far one criterion may sit from its target (its pair moves the other way). */
const SCORE_SPREAD = 1;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
/** Seeds tried when looking for the roster the story needs (pure computation, no I/O). */
const MAX_ASSIGNMENT_SEED_ATTEMPTS = 1000;
const SHIP_TEAM_SIZE = 3;
const SPRINT_TEAM_SIZE = 2;
/** The evidence sprint runs over a long weekend, so it is live at the anchor. */
const SPRINT_DAYS = 3;

const SHIP_TEMPLATE = 'build-48-hour-ship';
const SPRINT_TEMPLATE = 'research-evidence-sprint';
const STRATEGY_TEMPLATE = 'strategy-market-entry';

type Rubric = trials.TemplateView['rubric'];

const FIRST_COHORT = ['verified', 'ilya', 'noor', 'leo', 'priya'] as const;
const SECOND_COHORT = ['jun', 'elif', 'mateo', 'priya'] as const;

/** A team the story needs, by ordinal: the lead first, then the other members. */
type Roster = readonly (readonly [CastKey, ...CastKey[]])[];

/** UNIT ALPHA ships the climbing-club scheduler; UNIT BRAVO the makerspace tracker. */
const SHIP_ROSTER: Roster = [
  ['ilya', 'verified', 'priya'],
  ['leo', 'noor'],
];
const SPRINT_ROSTER: Roster = [
  ['jun', 'elif'],
  ['mateo', 'priya'],
];

/**
 * Individual score targets for the 48-Hour Ship. With the default weights
 * (60% team, 40% individual; pass 6, distinction 8.5): Ilya earns a
 * distinction, Priya fails, the rest pass whichever unit they are in.
 */
const SHIP_INDIVIDUAL_TARGET: Record<(typeof FIRST_COHORT)[number], number> = {
  verified: 7,
  ilya: 10,
  noor: 7,
  leo: 8,
  priya: 2,
};
/** The unit Ilya is in delivered more than the other. */
const LEADING_TEAM_TARGET = 8;
const TRAILING_TEAM_TARGET = 6;

const STATEMENTS: Partial<Record<CastKey, string>> = {
  verified: 'I ship backend systems for a living. I want the clock and the rubric to decide.',
  ilya: 'I want to see how my systems work holds up with a team and a deadline.',
  noor: 'I will make sure whatever team I join ships on time and knows why.',
  leo: 'Give me a real user and a deadline; I will bring working hardware or software.',
  priya: 'Second attempt. I learned where I stalled last time and want to prove the fix.',
  jun: 'I test claims for a living. An evidence sprint is exactly my kind of work.',
  elif: 'I read methods sections for fun. Put me in front of a contested claim.',
  mateo: 'I want to be measured on evidence, not on how confident I sound.',
};

/**
 * Whole-number criterion scores whose weighted mean is exactly `target`:
 * criteria of equal weight are paired and move in opposite directions.
 */
function scoresFor(run: SeedRun, rubric: Rubric, target: number): Record<string, number> {
  const scores: Record<string, number> = {};
  const byWeight = new Map<number, string[]>();
  for (const criterion of rubric) {
    scores[criterion.key] = target;
    byWeight.set(criterion.weight, [...(byWeight.get(criterion.weight) ?? []), criterion.key]);
  }
  for (const keys of byWeight.values()) {
    for (let index = 0; index + 1 < keys.length; index += 2) {
      const spread = run.rng.int(-SCORE_SPREAD, SCORE_SPREAD);
      const fits =
        target - Math.abs(spread) >= SCORE_FLOOR && target + Math.abs(spread) <= SCORE_CEILING;
      if (!fits) continue;
      scores[keys[index]!] = target + spread;
      scores[keys[index + 1]!] = target - spread;
    }
  }
  return scores;
}

function matchesRoster(run: SeedRun, plan: readonly trials.PlannedTeam[], roster: Roster) {
  return (
    plan.length === roster.length &&
    roster.every((team, ordinal) => {
      const planned = plan[ordinal]!;
      const [lead, ...others] = team.map((key) => run.person(key).memberId);
      return (
        planned.leadMemberId === lead &&
        planned.memberIds.length === team.length &&
        others.every((memberId) => planned.memberIds.includes(memberId))
      );
    })
  );
}

/**
 * Team assignment deals from candidates sorted by member id, and the
 * database generates those ids, so one seed deals different rosters on
 * different runs. `planTeams` is pure: find the seed that deals the roster
 * the story needs (a mismatch still seeds a valid, if different, trial).
 */
async function assignmentSeed(
  run: SeedRun,
  base: string,
  options: { strategy: trials.AssignmentStrategy; teamSize: number },
  roster: Roster,
): Promise<string> {
  const candidates = await Promise.all(
    roster.flat().map(async (key) => {
      const memberId = run.person(key).memberId;
      return {
        memberId,
        primaryDomain: castMember(key).primaryDomain,
        leadPriority: leadPriority(await activeRoles(run.system, memberId)),
      };
    }),
  );
  for (let attempt = 0; attempt < MAX_ASSIGNMENT_SEED_ATTEMPTS; attempt++) {
    const seed = attempt === 0 ? base : `${base}-${attempt}`;
    if (matchesRoster(run, trials.planTeams(candidates, { ...options, seed }), roster)) return seed;
  }
  return base;
}

async function templateNamed(run: SeedRun, key: string) {
  const templates = await trials.listTemplates(await run.as('operations'));
  const template = templates.find((candidate) => candidate.key === key);
  if (!template) throw new Error(`starter trial template ${key} is missing`);
  return template;
}

async function applyAll(run: SeedRun, trialId: string, keys: readonly CastKey[]) {
  for (const key of keys) {
    await run.later(run.rng.int(30, 300));
    await trials.applyToTrial(await run.as(key), { trialId, statement: STATEMENTS[key]! });
  }
}

/** Chapter 3 (86–72 days ago): the first Gauntlet. */
export function runFirstTrial(story: Story): void {
  let trialId = '';
  let rubric: Rubric = [];
  let results: trials.ResultsView['results'] = [];
  let teams: trials.AssignedTeamView[] = [];
  const memberKey = new Map<string, CastKey>();

  story.at(-86, 10, async (run) => {
    const template = await templateNamed(run, SHIP_TEMPLATE);
    rubric = template.rubric;
    const trial = await trials.createTrial(await run.as('operations'), {
      templateId: template.id,
      summary: 'Ship a working tool for a real user in 48 hours. Outcomes count, effort does not.',
      maxParticipants: 8,
      teamSize: SHIP_TEAM_SIZE,
    });
    trialId = trial.id;
    await trials.openRecruitment(await run.as('operations'), {
      trialId,
      recruitmentClosesAt: run.time(-80, 12),
    });
    for (const key of FIRST_COHORT) memberKey.set(run.person(key).memberId, key);
  });
  story.at(-85, 9, (run) => applyAll(run, trialId, FIRST_COHORT));
  story.at(-80, 13, async (run) => {
    const operations = await run.as('operations');
    await trials.selectParticipants(operations, {
      mode: 'manual',
      trialId,
      memberIds: run.memberIds(FIRST_COHORT),
    });
    const options = { strategy: 'balanced', teamSize: SHIP_TEAM_SIZE } as const;
    const assignment = await trials.assignTeams(await run.as('operations'), {
      trialId,
      ...options,
      seed: await assignmentSeed(run, 'first-gauntlet', options, SHIP_ROSTER),
    });
    teams = assignment.teams;
  });
  story.at(-79, 18, async (run) => {
    await trials.startTrial(await run.as('operations'), { trialId });
  });
  story.at(-78, 21, async (run) => {
    const lead = memberKey.get(teams[0]!.leadMemberId)!;
    await trials.submit(await run.as(lead), {
      trialId,
      summary: 'v1: intake form and scheduling backend for a youth climbing club, deployed.',
      links: ['https://demo.example.org/climb-scheduler'],
    });
  });
  story.at(-77, 16, async (run) => {
    const lead = memberKey.get(teams[0]!.leadMemberId)!;
    await trials.submit(await run.as(lead), {
      trialId,
      summary:
        'v2: club coaches onboarded; 23 real bookings in the last 12 hours. Known issues listed.',
      links: [
        'https://demo.example.org/climb-scheduler',
        'https://code.example.org/unit-alpha/climb-scheduler',
      ],
    });
  });
  story.at(-77, 17.8, async (run) => {
    const lead = memberKey.get(teams[1]!.leadMemberId)!;
    await trials.submit(await run.as(lead), {
      trialId,
      summary: 'Inventory tracker for a school makerspace. Works; two of five flows unfinished.',
      links: ['https://demo.example.org/makerspace-inventory'],
    });
  });
  // Submissions close on their own at deadline + grace (the trials.close_submissions job).
  story.at(-76, 11, async (run) => {
    const ilya = run.person('ilya').memberId;
    for (const team of teams) {
      await run.later(run.rng.int(20, 60));
      const target = team.memberIds.includes(ilya) ? LEADING_TEAM_TARGET : TRAILING_TEAM_TARGET;
      await trials.evaluate(await run.as('theo'), {
        trialId,
        teamId: team.id,
        scores: scoresFor(run, rubric, target),
        notes: 'Judged on what real users could do at the deadline.',
      });
    }
    for (const key of FIRST_COHORT) {
      await run.later(run.rng.int(10, 40));
      await trials.evaluate(await run.as('operations'), {
        trialId,
        memberId: run.person(key).memberId,
        scores: scoresFor(run, rubric, SHIP_INDIVIDUAL_TARGET[key]),
        notes: 'Individual contribution, from the channel log and the demo.',
      });
    }
  });
  story.at(-75, 10, async (run) => {
    ({ results } = await trials.publishResults(await run.as('operations'), { trialId }));
  });
  story.at(-74, 15, async (run) => {
    for (const key of FIRST_COHORT) {
      const result = results.find((candidate) => candidate.memberId === run.person(key).memberId);
      if (!result || !trials.isPassing(result.outcome)) continue;
      await run.later(run.rng.int(5, 30));
      await trials.applyRankConsequence(await run.as('core'), {
        trialId,
        memberId: result.memberId,
        reason: `48-Hour Ship result: ${result.outcome.toUpperCase()} at ${result.finalScore}.`,
      });
      await grant(run, 'core', key, 'verified', 'Passed the 48-Hour Ship.');
    }
  });
}

/** Chapter 7 (12 days ago → now): an evidence sprint running at the anchor. */
export function runActiveTrial(story: Story): void {
  let trialId = '';
  let teams: trials.AssignedTeamView[] = [];
  const memberKey = new Map<string, CastKey>();

  story.at(-12, 10, async (run) => {
    const template = await templateNamed(run, SPRINT_TEMPLATE);
    const trial = await trials.createTrial(await run.as('theo'), {
      templateId: template.id,
      title: 'Evidence Sprint: Sleep and Memory',
      summary: 'Settle a contested claim about sleep and memory with evidence. Teams of two.',
      durationMinutes: SPRINT_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR,
      teamSize: SPRINT_TEAM_SIZE,
      maxParticipants: 6,
    });
    trialId = trial.id;
    await trials.openRecruitment(await run.as('theo'), {
      trialId,
      recruitmentClosesAt: run.time(-4, 18),
    });
    for (const key of SECOND_COHORT) memberKey.set(run.person(key).memberId, key);
  });
  story.at(-11, 12, (run) => applyAll(run, trialId, SECOND_COHORT));
  story.at(-3, 11, async (run) => {
    await trials.selectParticipants(await run.as('theo'), {
      mode: 'manual',
      trialId,
      memberIds: run.memberIds(SECOND_COHORT),
    });
    const options = { strategy: 'random', teamSize: SPRINT_TEAM_SIZE } as const;
    const assignment = await trials.assignTeams(await run.as('theo'), {
      trialId,
      ...options,
      seed: await assignmentSeed(run, 'evidence-sprint', options, SPRINT_ROSTER),
    });
    teams = assignment.teams;
  });
  story.at(-1, 9, async (run) => {
    await trials.startTrial(await run.as('theo'), { trialId });
  });
  story.at(-1, 22, async (run) => {
    const lead = memberKey.get(teams[0]!.leadMemberId)!;
    await trials.submit(await run.as(lead), {
      trialId,
      summary:
        'Draft verdict: the effect is real but smaller than claimed. 14 sources graded; two preregistered.',
      links: ['https://notes.example.org/evidence-sprint/draft'],
    });
  });
}

/** Chapter 9 (2 days ago → now): a strategy trial open for applications. */
export function openRecruitingTrial(story: Story): void {
  let trialId = '';
  story.at(-2, 15, async (run) => {
    const template = await templateNamed(run, STRATEGY_TEMPLATE);
    const trial = await trials.createTrial(await run.as('operations'), {
      templateId: template.id,
      summary: 'Recommend how a student co-op should enter a new city. Evidence over vibes.',
      recruitmentClosesAt: run.time(5, 18),
      maxParticipants: 8,
    });
    trialId = trial.id;
    await trials.openRecruitment(await run.as('operations'), { trialId });
  });
  story.at(-1, 13, async (run) => {
    await trials.applyToTrial(await run.as('noor'), {
      trialId,
      statement: 'I have entered three cities with a volunteer network. I want to do it with data.',
    });
  });
}
