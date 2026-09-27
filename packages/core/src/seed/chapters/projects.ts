import { DAY } from '../../kernel/clock';
import * as projects from '../../projects';
import type { ProjectStatus } from '../../projects';
import type { CastKey } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/**
 * Projects in every status (idea, planning, building, testing, shipped,
 * archived) with milestones, links, members and contributions — verified,
 * awaiting review and rejected. Mara ships three, which unlocks BUILDER.
 */

/** Milestones are planned two weeks apart. */
const MILESTONE_SPACING_DAYS = 14;

type ContributionKind = Parameters<typeof projects.recordContribution>[1]['kind'];

interface ProjectPlan {
  owner: CastKey;
  title: string;
  summary: string;
  description: string;
  domainKey: string;
  visibility: 'public' | 'members' | 'private';
  milestones: string[];
}

const PLANS = {
  helios: {
    owner: 'mara',
    title: 'Helios ADCS',
    summary: 'Attitude determination and control for a 3U student cubesat.',
    description:
      'Flight software for attitude determination and control. Sensor fusion, magnetorquer control, and a hardware-in-the-loop test bench.',
    domainKey: 'create',
    visibility: 'public',
    milestones: ['Sensor fusion on the bench', 'Detumble mode in HIL', 'Flight review passed'],
  },
  orbitTools: {
    owner: 'mara',
    title: 'Orbit Tools CLI',
    summary: 'Command-line pass predictions and TLE management for ground teams.',
    description: 'Predicts passes, manages TLE sets and exports schedules for ground stations.',
    domainKey: 'create',
    visibility: 'public',
    milestones: ['Pass prediction', 'Schedule export'],
  },
  groundstation: {
    owner: 'mara',
    title: 'Groundstation Dashboard',
    summary: 'Live telemetry dashboard for the student ground station.',
    description: 'Streams decoded telemetry, flags anomalies, and archives every pass.',
    domainKey: 'create',
    visibility: 'members',
    milestones: ['Telemetry decoder', 'Anomaly flags', 'Pass archive'],
  },
  sleepAtlas: {
    owner: 'sana',
    title: 'Sleep Atlas',
    summary: 'Open atlas of sleep studies with effect sizes and quality grades.',
    description:
      'A structured, graded map of sleep research. Every entry links the primary source and its design.',
    domainKey: 'mind',
    visibility: 'public',
    milestones: ['Schema and grading rubric', 'First 100 studies graded', 'Public beta'],
  },
  ledger: {
    owner: 'ilya',
    title: 'Ledger',
    summary: 'Open grant tracker for student societies.',
    description:
      'Tracks grants from application to final report. Multi-society, audit trail, exports for treasurers.',
    domainKey: 'create',
    visibility: 'members',
    milestones: ['Multi-society accounts', 'Treasurer exports', 'Audit trail'],
  },
  quorum: {
    owner: 'noor',
    title: 'Quorum',
    summary: 'Async decision records for volunteer teams.',
    description: 'Proposals, objections and decisions with deadlines, so teams stop deciding in chat.',
    domainKey: 'life',
    visibility: 'members',
    milestones: ['Decision record format', 'Pilot with two teams'],
  },
  fieldLogger: {
    owner: 'leo',
    title: 'Field Logger v2',
    summary: 'Solar-powered sensor logger for remote field sites.',
    description: 'Successor to the two-year battery logger: solar charging and LoRa uplink.',
    domainKey: 'create',
    visibility: 'members',
    milestones: [],
  },
  crewLoad: {
    owner: 'aiko',
    title: 'Crew Load',
    summary: 'Training-load model for rowing crews.',
    description: 'Estimates fatigue from erg sessions and heart rate. Paused: data access fell through.',
    domainKey: 'body',
    visibility: 'members',
    milestones: ['Erg data import'],
  },
} as const satisfies Record<string, ProjectPlan>;

type ProjectKey = keyof typeof PLANS;

interface ProjectState {
  id: string;
  milestones: string[];
  /** Milestones completed so far (always the first ones, in plan order). */
  done: number;
}

class ProjectBook {
  private readonly state = new Map<ProjectKey, ProjectState>();

  get(key: ProjectKey): ProjectState {
    const state = this.state.get(key);
    if (!state) throw new Error(`seed project ${key} not created yet`);
    return state;
  }

  async create(run: SeedRun, key: ProjectKey): Promise<void> {
    const plan: ProjectPlan = PLANS[key];
    const project = await projects.createProject(await run.as(plan.owner), {
      title: plan.title,
      summary: plan.summary,
      description: plan.description,
      domainKey: plan.domainKey,
      visibility: plan.visibility,
    });
    const milestones: string[] = [];
    for (const [index, title] of plan.milestones.entries()) {
      const milestone = await projects.addMilestone(await run.as(plan.owner), {
        projectId: project.id,
        title,
        dueAt: new Date(run.clock.now().getTime() + (index + 1) * MILESTONE_SPACING_DAYS * DAY),
      });
      milestones.push(milestone.id);
    }
    this.state.set(key, { id: project.id, milestones, done: 0 });
  }

  async move(run: SeedRun, key: ProjectKey, ...path: ProjectStatus[]): Promise<void> {
    for (const status of path) {
      await run.later(run.rng.int(30, 240));
      await projects.changeProjectStatus(await run.as(PLANS[key].owner), {
        projectId: this.get(key).id,
        status,
      });
    }
  }

  /** Complete milestones until `total` of them are done. */
  async complete(run: SeedRun, key: ProjectKey, total: number): Promise<void> {
    const state = this.get(key);
    for (const milestoneId of state.milestones.slice(state.done, total)) {
      await run.later(run.rng.int(60, 600));
      await projects.completeMilestone(await run.as(PLANS[key].owner), {
        projectId: state.id,
        milestoneId,
      });
      state.done += 1;
    }
  }

  async addMember(
    run: SeedRun,
    key: ProjectKey,
    member: CastKey,
    role: 'maintainer' | 'contributor',
  ) {
    await projects.addProjectMember(await run.as(PLANS[key].owner), {
      projectId: this.get(key).id,
      memberId: run.person(member).memberId,
      role,
    });
  }

  async contribute(
    run: SeedRun,
    key: ProjectKey | null,
    member: CastKey,
    kind: ContributionKind,
    title: string,
    url?: string,
  ): Promise<string> {
    const contribution = await projects.recordContribution(await run.as(member), {
      ...(key ? { projectId: this.get(key).id } : {}),
      kind,
      title,
      url,
    });
    return contribution.id;
  }
}

async function verifyContribution(run: SeedRun, staff: CastKey, contributionId: string) {
  await projects.verifyContribution(await run.as(staff), {
    contributionId,
    note: 'Checked against the repository history.',
  });
}

/** Chapter 1–6 (140–40 days ago): the founding projects and the first ships. */
function buildEarlyProjects(story: Story, book: ProjectBook): void {
  story.at(-140, 13, async (run) => {
    await book.create(run, 'helios');
    await projects.addProjectLink(await run.as('mara'), {
      projectId: book.get('helios').id,
      label: 'Repository',
      url: 'https://code.example.org/mara/helios-adcs',
    });
    await book.move(run, 'helios', 'planning', 'building');
  });
  story.at(-130, 15, async (run) => {
    await book.create(run, 'sleepAtlas');
    await book.move(run, 'sleepAtlas', 'planning');
  });
  story.at(-120, 11, async (run) => {
    await book.create(run, 'crewLoad');
    await book.move(run, 'crewLoad', 'building');
  });
  story.at(-118, 10, async (run) => {
    await book.complete(run, 'helios', 1);
    const fusion = await book.contribute(
      run,
      'helios',
      'mara',
      'code',
      'Extended Kalman filter for attitude estimation',
      'https://code.example.org/mara/helios-adcs/pull/12',
    );
    await verifyContribution(run, 'operations', fusion);
  });
  story.at(-103, 14, async (run) => {
    await book.addMember(run, 'helios', 'leo', 'contributor');
    await book.complete(run, 'helios', 2);
    await book.move(run, 'helios', 'testing');
  });
  story.at(-101, 12, async (run) => {
    const bench = await book.contribute(
      run,
      'helios',
      'leo',
      'code',
      'Magnetometer calibration rig for the HIL bench',
      'https://code.example.org/mara/helios-adcs/pull/19',
    );
    await verifyContribution(run, 'theo', bench);
    await book.move(run, 'sleepAtlas', 'building');
  });
  story.at(-100, 16, async (run) => {
    await book.complete(run, 'helios', 3);
    await book.move(run, 'helios', 'shipped');
  });
  story.at(-95, 10, async (run) => {
    await book.create(run, 'ledger');
    await book.move(run, 'ledger', 'planning', 'building');
    await book.addMember(run, 'ledger', 'noor', 'maintainer');
  });
  story.at(-88, 13, async (run) => {
    await book.create(run, 'orbitTools');
    await book.move(run, 'orbitTools', 'building');
  });
  story.at(-80, 17, async (run) => {
    await book.complete(run, 'orbitTools', 2);
    await book.move(run, 'orbitTools', 'shipped');
  });
  story.at(-72, 10, async (run) => {
    await book.complete(run, 'ledger', 1);
    const accounts = await book.contribute(
      run,
      'ledger',
      'ilya',
      'code',
      'Multi-society accounts with per-society roles',
      'https://code.example.org/ilya/ledger/pull/4',
    );
    await verifyContribution(run, 'operations', accounts);
    await book.addMember(run, 'ledger', 'verified', 'contributor');
  });
  story.at(-66, 11, async (run) => {
    await book.create(run, 'groundstation');
    await book.move(run, 'groundstation', 'building');
  });
  story.at(-60, 12, async (run) => {
    await projects.changeProjectStatus(await run.as('aiko'), {
      projectId: book.get('crewLoad').id,
      status: 'archived',
    });
  });
  story.at(-52, 15, async (run) => {
    await book.complete(run, 'groundstation', 3);
    await book.move(run, 'groundstation', 'testing', 'shipped');
  });
}

/** Chapter 7–10 (35 days ago → now): work in flight and the review queue. */
function buildCurrentProjects(story: Story, book: ProjectBook): void {
  story.at(-35, 10, async (run) => {
    await book.addMember(run, 'sleepAtlas', 'elif', 'contributor');
    await book.complete(run, 'sleepAtlas', 2);
  });
  story.at(-30, 14, async (run) => {
    await book.create(run, 'quorum');
    await book.move(run, 'quorum', 'planning');
    const rejected = await book.contribute(
      run,
      'ledger',
      'verified',
      'code',
      'Refactor export module',
      'https://code.example.org/ilya/ledger/pull/9',
    );
    await projects.rejectContribution(await run.as('theo'), {
      contributionId: rejected,
      reason: 'The linked change was reverted before merge; resubmit once it lands.',
    });
  });
  story.at(-20, 16, async (run) => {
    await book.move(run, 'sleepAtlas', 'testing');
    const grading = await book.contribute(
      run,
      'sleepAtlas',
      'elif',
      'writing',
      'Plain-language summaries for 40 graded studies',
      'https://notes.example.org/sleep-atlas/summaries',
    );
    await verifyContribution(run, 'operations', grading);
  });
  story.at(-6, 12, async (run) => {
    await book.contribute(
      run,
      'ledger',
      'verified',
      'code',
      'Treasurer CSV export with audit columns',
      'https://code.example.org/ilya/ledger/pull/14',
    );
    await book.contribute(
      run,
      'ledger',
      'noor',
      'operations',
      'Onboarded four new societies and wrote the treasurer guide',
    );
  });
  story.at(-5, 18, async (run) => {
    await book.create(run, 'fieldLogger');
  });
  story.at(-2, 20, async (run) => {
    await book.contribute(
      run,
      null,
      'member',
      'design',
      'Design system audit for a nonprofit website',
      'https://portfolio.example.org/dev_member/audit',
    );
  });
}

/** Both project chapters share one book of project ids. */
export function writeProjects(story: Story): void {
  const book = new ProjectBook();
  buildEarlyProjects(story, book);
  buildCurrentProjects(story, book);
}
