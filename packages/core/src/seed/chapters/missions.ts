import * as missions from '../../missions';
import type { CastKey } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/**
 * Missions in every state: verified (history), a rejection then a verified
 * resubmission, a team mission assigned and not yet accepted, submissions
 * awaiting review, one in progress, an open mission nobody has taken yet,
 * a closed one and a staff draft.
 */

interface Taken {
  assignmentId: string;
}

async function publish(
  run: SeedRun,
  staff: CastKey,
  input: Parameters<typeof missions.createMission>[1],
): Promise<string> {
  const draft = await missions.createMission(await run.as(staff), input);
  await missions.publishMission(await run.as(staff), { missionId: draft.id, announce: true });
  return draft.id;
}

async function take(run: SeedRun, key: CastKey, missionId: string): Promise<Taken> {
  const assignment = await missions.selfAssignMission(await run.as(key), { missionId });
  return { assignmentId: assignment.id };
}

async function deliver(run: SeedRun, key: CastKey, taken: Taken, text: string, url: string) {
  await missions.submitMission(await run.as(key), {
    assignmentId: taken.assignmentId,
    submission: text,
    evidence: { title: 'Write-up and artifacts', url },
  });
}

async function verify(run: SeedRun, staff: CastKey, taken: Taken, feedback: string) {
  await missions.verifySubmission(await run.as(staff), {
    assignmentId: taken.assignmentId,
    feedback,
  });
}

/** Chapter 4 (70–40 days ago): the first missions, verified. */
export function runEarlyMissions(story: Story): void {
  let fieldTest = '';
  let sourceAudit = '';
  const taken = new Map<CastKey, Taken>();

  story.at(-70, 10, async (run) => {
    fieldTest = await publish(run, 'operations', {
      title: 'Field test: a real onboarding flow',
      brief:
        'Watch three real users go through an onboarding flow you did not build. Report where they stall, with timestamps. Evidence: the notes and a short recording summary.',
      type: 'build',
      facetKey: 'create.projects',
      durationHours: 72,
    });
  });
  story.at(-69, 14, async (run) => {
    taken.set('verified', await take(run, 'verified', fieldTest));
    await run.later(90);
    taken.set('noor', await take(run, 'noor', fieldTest));
  });
  story.at(-68, 11, async (run) => {
    await deliver(
      run,
      'verified',
      taken.get('verified')!,
      'Three sessions. Two users stalled at email verification (avg 94 s); one abandoned at pricing.',
      'https://notes.example.org/field-test/verified',
    );
    await run.later(240);
    await deliver(
      run,
      'noor',
      taken.get('noor')!,
      'Three sessions with timestamps. The invite step confused all three; proposed copy attached.',
      'https://notes.example.org/field-test/noor',
    );
  });
  story.at(-67, 10, async (run) => {
    await verify(run, 'theo', taken.get('verified')!, 'Precise timestamps; findings reproduce.');
    await verify(run, 'operations', taken.get('noor')!, 'Clear, actionable, and the copy works.');
  });

  story.at(-45, 10, async (run) => {
    sourceAudit = await publish(run, 'theo', {
      title: 'Source audit: ten viral claims',
      brief:
        'Pick ten widely shared science claims. For each: the primary source, what it actually shows, and a one-line verdict. Evidence: the audit table.',
      type: 'research',
      facetKey: 'mind.research',
      durationHours: 96,
    });
  });
  story.at(-44, 12, async (run) => {
    taken.set('sana', await take(run, 'sana', sourceAudit));
    taken.set('ilya', await take(run, 'ilya', sourceAudit));
  });
  story.at(-43, 16, async (run) => {
    await deliver(
      run,
      'sana',
      taken.get('sana')!,
      'Ten claims traced. Four overstated, two unsupported, four hold. Table links each primary source.',
      'https://notes.example.org/source-audit/sana',
    );
    await deliver(
      run,
      'ilya',
      taken.get('ilya')!,
      'Ten claims with verdicts.',
      'https://notes.example.org/source-audit/ilya',
    );
  });
  story.at(-42, 10, async (run) => {
    await verify(run, 'theo', taken.get('sana')!, 'Exemplary: primary sources, careful verdicts.');
    await missions.rejectSubmission(await run.as('theo'), {
      assignmentId: taken.get('ilya')!.assignmentId,
      feedback: 'Verdicts lack sources for claims 3, 7 and 9. Add them and resubmit.',
    });
  });
  story.at(-41, 20, (run) =>
    deliver(
      run,
      'ilya',
      taken.get('ilya')!,
      'Resubmitted: primary sources added for claims 3, 7 and 9; verdict on 7 changed to unsupported.',
      'https://notes.example.org/source-audit/ilya-v2',
    ),
  );
  story.at(-40, 11, async (run) => {
    await verify(run, 'operations', taken.get('ilya')!, 'Sources added; verdicts now hold.');
    await missions.closeMission(await run.as('operations'), { missionId: fieldTest });
  });
}

/** Chapter 8 (9 days ago → now): the live mission board. */
export function runCurrentMissions(story: Story): void {
  let writeUp = '';
  let marketMap = '';
  const taken = new Map<CastKey, Taken>();

  story.at(-9, 10, async (run) => {
    writeUp = await publish(run, 'operations', {
      title: 'Post-mortem: one thing you shipped',
      brief:
        'Write a one-page post-mortem of something you shipped: goal, what happened, what you would change. Evidence: the document.',
      type: 'creative',
      facetKey: 'life.execution',
      durationHours: 168,
    });
  });
  story.at(-8, 15, async (run) => {
    taken.set('mateo', await take(run, 'mateo', writeUp));
  });
  story.at(-6, 10, async (run) => {
    marketMap = await publish(run, 'theo', {
      title: 'Team: map a local market',
      brief:
        'As a pair, map every competitor in one local market and estimate their volumes from public data. Evidence: the map and the method.',
      type: 'team',
      facetKey: 'life.business',
      durationHours: 240,
    });
    await missions.assignMission(await run.as('theo'), {
      missionId: marketMap,
      memberIds: run.memberIds(['jun', 'elif']),
      teamKey: 'market-map',
    });
  });
  story.at(-3, 12, async (run) => {
    taken.set('member', await take(run, 'member', writeUp));
  });
  story.at(-2, 18, (run) =>
    deliver(
      run,
      'mateo',
      taken.get('mateo')!,
      'Post-mortem of our swerve module release: goal, timeline, two failures and the fixes.',
      'https://notes.example.org/post-mortem/mateo',
    ),
  );
  story.at(-1, 11, async (run) => {
    await publish(run, 'operations', {
      title: 'Literature map: sleep and cognition',
      brief:
        'Map the twenty most cited studies on sleep and cognition since 2015: design, sample size, effect. Evidence: the map.',
      type: 'research',
      facetKey: 'mind.research',
      durationHours: 120,
    });
    await missions.createMission(await run.as('theo'), {
      title: 'Coach a first-time trial team',
      brief:
        'Shadow a team through a trial as a coach: no hands on keyboard, questions only. Draft pending rubric.',
      type: 'strategy',
      facetKey: 'life.execution',
    });
  });
}
