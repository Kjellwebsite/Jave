/**
 * End-to-end mission fixtures — TEST DATA ONLY. A small, realistic board
 * written through the missions services (so assignments, submissions,
 * reviews, evidence, events and audit entries are genuine): open missions
 * with work in progress and in review, a team mission, a returned
 * submission, a verified and closed mission, and a draft. Only fixture
 * members take part; the dev personas stay free for the specs. No reward
 * achievements are granted, and the queued jobs stay queued (no bot runs).
 */
import { eq } from 'drizzle-orm';
import {
  createContext,
  DAY,
  missions,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  withActor,
} from '@jave/core';
import { createDatabase, users } from '@jave/database';

/** Titles the specs may look for. */
export const MISSION_FIXTURES = {
  bench: 'Attitude-control bench test',
  literature: 'Orbital debris literature map',
  relay: 'Relay team build',
  retrospective: 'Launch window retrospective',
  draft: 'Hackathon logistics plan',
} as const;

const DISCORD = {
  operations: '100000000000000003',
  core: '100000000000000002',
  mara: '110000000000000011',
  ilya: '110000000000000012',
  sana: '110000000000000013',
  elena: '110000000000000017',
} as const;
type Person = keyof typeof DISCORD;

const BENCH_DEADLINE_DAYS = 12;
const BENCH_SLOTS = 4;
const BENCH_HOURS = 96;
const RELAY_SLOTS = 6;
const RELAY_TEAM = 'relay-a';

async function as(system: ServiceContext, person: Person): Promise<ServiceContext> {
  const [user] = await system.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, DISCORD[person]));
  if (!user)
    throw new Error(`mission fixture: ${person} missing, seed the dashboard fixtures first`);
  return withActor(system, await resolveUserActor(system, user.id));
}

async function memberId(ctx: ServiceContext): Promise<string> {
  const id = ctx.actor.kind === 'user' ? ctx.actor.memberId : null;
  if (!id) throw new Error('mission fixture: member profile missing');
  return id;
}

export async function seedMissionFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-missions' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-missions-seed') });
  try {
    const ops = await as(system, 'operations');
    const core = await as(system, 'core');
    const [mara, ilya, sana, elena] = await Promise.all([
      as(system, 'mara'),
      as(system, 'ilya'),
      as(system, 'sana'),
      as(system, 'elena'),
    ]);
    const now = system.clock.now();

    async function open(input: Parameters<typeof missions.createMission>[1]) {
      const draft = await missions.createMission(ops, input);
      const { mission } = await missions.publishMission(ops, {
        missionId: draft.id,
        announce: false,
      });
      return mission;
    }

    const bench = await open({
      title: MISSION_FIXTURES.bench,
      brief:
        'Run the reaction-wheel controller on the lab bench for a full simulated orbit.\nEvidence: the telemetry log and a one-page note on anything that drifted.',
      type: 'build',
      facetKey: 'create.technical',
      evidenceRequired: true,
      maxAssignees: BENCH_SLOTS,
      durationHours: BENCH_HOURS,
      deadlineAt: new Date(now.getTime() + BENCH_DEADLINE_DAYS * DAY),
      rewardNote: 'Counts toward BUILDER.',
    });
    const maraBench = await missions.selfAssignMission(mara, { missionId: bench.id });
    await missions.submitMission(mara, {
      assignmentId: maraBench.id,
      submission:
        'Ran the full 92-minute orbit twice. Pointing error stayed under 0.4 degrees; wheel 3 warms up faster than the model predicts.',
      evidence: {
        title: 'Bench telemetry, two passes',
        url: 'https://example.org/bench-telemetry',
      },
    });
    await missions.assignMission(ops, { missionId: bench.id, memberIds: [await memberId(elena)] });
    const ilyaBench = await missions.selfAssignMission(ilya, { missionId: bench.id });
    if (ilyaBench.status === 'assigned')
      await missions.acceptMission(ilya, { assignmentId: ilyaBench.id });

    const literature = await open({
      title: MISSION_FIXTURES.literature,
      brief:
        'Map what is published on debris tracking gaps below 10 cm since 2022. One page, sources linked, open questions last.',
      type: 'research',
      facetKey: 'mind.research',
      evidenceRequired: false,
    });
    const sanaLiterature = await missions.selfAssignMission(sana, { missionId: literature.id });
    await missions.submitMission(sana, {
      assignmentId: sanaLiterature.id,
      submission: 'Draft map attached as text: twelve sources, three open questions.',
    });
    await missions.rejectSubmission(ops, {
      assignmentId: sanaLiterature.id,
      feedback: 'Cite the 2025 ESA environment report and add the tracking-gap section.',
    });

    const relay = await open({
      title: MISSION_FIXTURES.relay,
      brief:
        'Two-person teams build a store-and-forward relay between the rooftop antenna and the lab. One submission per team.',
      type: 'team',
      facetKey: 'create.projects',
      evidenceRequired: true,
      maxAssignees: RELAY_SLOTS,
    });
    await missions.assignMission(ops, {
      missionId: relay.id,
      memberIds: [await memberId(mara), await memberId(sana)],
      teamKey: RELAY_TEAM,
    });

    const retrospective = await open({
      title: MISSION_FIXTURES.retrospective,
      brief:
        'Write the retrospective of the last launch window: what slipped, why, and the one change that would have saved a day.',
      type: 'strategy',
      facetKey: 'mind.reasoning',
      evidenceRequired: false,
    });
    const elenaRetro = await missions.selfAssignMission(elena, { missionId: retrospective.id });
    await missions.submitMission(elena, {
      assignmentId: elenaRetro.id,
      submission:
        'The slip was the ground-station booking, not the vehicle. Book two windows ahead next time.',
    });
    await missions.verifySubmission(core, {
      assignmentId: elenaRetro.id,
      feedback: 'Clear and specific. On your record.',
    });
    await missions.closeMission(ops, { missionId: retrospective.id });

    await missions.createMission(ops, {
      title: MISSION_FIXTURES.draft,
      brief: 'Plan the autumn hackathon: venue, schedule, judging, and who staffs each shift.',
      type: 'social',
    });
  } finally {
    await database.close();
  }
}
