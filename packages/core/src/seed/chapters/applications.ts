import {
  decideApplication,
  getOrCreateDraft,
  reviewApplication,
  scheduleInterview,
  submitApplication,
  updateDraft,
  withdrawApplication,
} from '../../applications';
import type { UpdateDraftInput } from '../../applications/schemas';
import type { ApplicationRecommendation } from '../../applications/state-machine';
import { type CastKey, castMember } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';
import { join } from './people';

/**
 * Applications in every state: two admitted cohorts (history), a rejection,
 * a withdrawal, and the live queue — submitted, in review, interview
 * scheduled, and one draft (the MEMBER dev persona's, so it can be finished
 * from the dashboard).
 */

interface ApplicationStory {
  motivation: string;
  experience: string;
  projects: string;
  references: string;
}

const STORIES: Partial<Record<CastKey, ApplicationStory>> = {
  verified: {
    motivation:
      'I want to work next to people who ship faster than I do and tell me when my work is not good enough.',
    experience:
      'Four years of backend work for two research labs: ingestion pipelines, job queues, on-call for both.',
    projects:
      'Maintains an open-source sample tracker used by three university labs. Wrote the migration tooling.',
    references: 'Lab manager at the genomics lab (contact on request).',
  },
  ilya: {
    motivation:
      'I build distributed systems alone. I want a peer group that can check my reasoning and my code.',
    experience:
      'Implemented Raft from the paper for a university course, then rewrote it for a startup that runs it in production.',
    projects: 'Ledger, an open grant tracker for student societies. 40 societies onboarded.',
    references: 'CTO of the startup running the consensus layer.',
  },
  noor: {
    motivation:
      'I am good at making teams deliver. I want to be tested on it by people who will not flatter me.',
    experience:
      'Coordinated a volunteer relief network across three cities for two years: 120 volunteers, weekly deliveries.',
    projects: 'Built the scheduling spreadsheet-turned-app the network still uses.',
    references: 'Two city coordinators of the relief network.',
  },
  leo: {
    motivation:
      'I want harder problems and people who care about working hardware more than slides.',
    experience:
      'Designed low-power sensor rigs for field biologists; eleven units deployed for a full season.',
    projects: 'Open hardware logger with a two-year battery life. Schematics and firmware public.',
    references: 'Principal investigator of the field station.',
  },
  priya: {
    motivation:
      'I want my analysis to be measured against a real bar, not against a grading curve.',
    experience:
      'Analyst for a regional food bank: demand forecasting and route planning in Python and SQL.',
    projects: 'Forecasting notebook that cut food waste at two depots by a fifth.',
    references: 'Operations director at the food bank.',
  },
  jun: {
    motivation:
      'I want to test my models against people who will attack their assumptions, not admire them.',
    experience: 'Two years of agent-based modelling; one working paper on informal credit markets.',
    projects: 'Open simulation framework for emerging-market credit, with reproducible notebooks.',
    references: 'Supervisor of the working paper.',
  },
  elif: {
    motivation:
      'I explain research for a living. I want to be around people who produce it at a high level.',
    experience:
      'Editor of a student research journal for three years; forty papers edited, two retractions caught.',
    projects: 'Plain-language summaries series read by 8,000 subscribers.',
    references: 'Faculty advisor of the journal.',
  },
  mateo: {
    motivation: 'I want to build robots with people who finish things and publish what they learn.',
    experience:
      'Captain of a school robotics team for three seasons; two regional titles, all designs open-sourced.',
    projects: 'Open-source swerve-drive module used by six other teams.',
    references: 'Team mentor and a regional competition judge.',
  },
  luca: {
    motivation: 'I have a big idea and want investors and co-founders from this network.',
    experience:
      'Started building a note-taking app with AI features this spring, still in progress.',
    projects: 'Note-taking app, private beta planned.',
    references: 'None yet.',
  },
  hana: {
    motivation:
      'I want to push my motion design into product work and be judged on outcomes, not style.',
    experience:
      'Freelance illustrator for four years; motion work for two indie games and a museum exhibit.',
    projects: 'Museum exhibit title sequence; indie game menus and trailers.',
    references: 'Art director of the museum exhibit.',
  },
  omar: {
    motivation:
      'I run a co-op of forty riders. I want a sharper peer group to pressure-test how I operate it.',
    experience:
      'Founded and ran a campus delivery co-op for two years: forty riders, break-even in month five.',
    projects: 'Dispatch tool for the co-op; public operating handbook.',
    references: 'Two co-op board members.',
  },
  freya: {
    motivation: 'I want to learn to turn field data into tools other researchers use.',
    experience: 'Four summers of Arctic seabird tagging; maintains the station’s tracking dataset.',
    projects: 'Cleaned, documented tracking dataset used in two published studies.',
    references: 'Station lead scientist.',
  },
  tomas: {
    motivation: 'I solve puzzles well. I want to prove I can also build things people depend on.',
    experience: 'Two regional olympiad medals; teaching assistant for an algorithms course.',
    projects: 'Contest-practice judge used by his school club.',
    references: 'Olympiad team coach.',
  },
  member: {
    motivation:
      'I design interfaces and I want to learn to ship them end to end with engineers who hold a high bar.',
    experience:
      'Three years of product design at an agency; recently shipping my own front-end work.',
    projects: 'Portfolio of two shipped marketing sites and a design system.',
    references: 'Design director at the agency.',
  },
};

function draftFor(key: CastKey): UpdateDraftInput {
  const cast = castMember(key);
  const story = STORIES[key];
  if (!story) throw new Error(`no application story for ${key}`);
  return {
    domainKey: cast.primaryDomain,
    motivation: story.motivation,
    experience: story.experience,
    projects: story.projects,
    portfolioUrl: `https://portfolio.example.org/${cast.username}`,
    evidenceLinks: [`https://code.example.org/${cast.username}`],
    references: story.references,
  };
}

async function submit(run: SeedRun, key: CastKey): Promise<string> {
  const { application } = await getOrCreateDraft(await run.as(key));
  await run.later(run.rng.int(20, 90));
  await updateDraft(await run.as(key), draftFor(key));
  await run.later(run.rng.int(10, 60));
  await submitApplication(await run.as(key));
  return application.id;
}

async function review(
  run: SeedRun,
  reviewer: CastKey,
  applicationId: string,
  recommendation: ApplicationRecommendation,
  score: number,
  note: string,
): Promise<void> {
  await reviewApplication(await run.as(reviewer), { applicationId, recommendation, score, note });
}

async function accept(run: SeedRun, decider: CastKey, applicationId: string): Promise<void> {
  await decideApplication(await run.as(decider), {
    applicationId,
    decision: 'accept',
    reason: 'Evidence checks out; reviews agree. Admit to the Gauntlet.',
    applicantMessage: 'Welcome to the Gauntlet. Your first trial will be announced soon.',
  });
}

const joinAt = (story: Story, key: CastKey, hour: number) =>
  story.at(-castMember(key).joinedDaysAgo, hour, (run) => join(run, key));

/** Chapter 2 (110–89 days ago): the first applicants become TRIAL members. */
export function admitFirstCohort(story: Story): void {
  const cohort = ['verified', 'ilya', 'noor', 'leo', 'priya'] as const;
  const ids = new Map<CastKey, string>();
  for (const [index, key] of cohort.entries()) {
    joinAt(story, key, 9 + index * 2);
    story.at(-99 + index, 10 + index * 2, async (run) => {
      ids.set(key, await submit(run, key));
    });
    story.at(-94 + index, 10, (run) =>
      review(
        run,
        index % 2 === 0 ? 'operations' : 'theo',
        ids.get(key)!,
        'accept',
        run.rng.int(4, 5),
        'Concrete, verifiable proof of work. References confirmed.',
      ),
    );
    story.at(-89, 11 + index / 3, (run) =>
      accept(run, index % 2 === 0 ? 'core' : 'kai', ids.get(key)!),
    );
  }
}

/** Chapter 5 (40–20 days ago): a second cohort, a rejection and a withdrawal. */
export function admitSecondCohort(story: Story): void {
  const ids = new Map<CastKey, string>();
  const submitAt = (key: CastKey, day: number, hour: number) =>
    story.at(day, hour, async (run) => {
      ids.set(key, await submit(run, key));
    });
  const id = (key: CastKey) => ids.get(key)!;

  joinAt(story, 'jun', 10);
  joinAt(story, 'elif', 15);
  joinAt(story, 'mateo', 12);
  joinAt(story, 'luca', 18);
  joinAt(story, 'hana', 18);
  submitAt('jun', -34, 10);
  submitAt('elif', -33, 19);
  submitAt('mateo', -32, 15);
  submitAt('luca', -29, 22);
  submitAt('hana', -24, 20);

  story.at(-30, 9, (run) =>
    review(run, 'theo', id('jun'), 'accept', 5, 'Models are careful and reproducible.'),
  );
  story.at(-30, 14, (run) =>
    review(run, 'operations', id('elif'), 'accept', 4, 'Strong editorial record; verifiable.'),
  );
  story.at(-29, 10, async (run) => {
    await review(run, 'theo', id('mateo'), 'interview', 4, 'Promising; want to hear how he leads.');
    await scheduleInterview(await run.as('core'), {
      applicationId: id('mateo'),
      interviewAt: run.time(-27, 17),
      applicantMessage: 'Voice channel: Interview Room. Twenty minutes.',
    });
  });
  story.at(-27, 16, (run) =>
    review(
      run,
      'operations',
      id('luca'),
      'reject',
      2,
      'No shipped work yet; claims exceed the evidence.',
    ),
  );
  story.at(-26, 10, (run) => accept(run, 'core', id('jun')));
  story.at(-26, 11, (run) => accept(run, 'kai', id('elif')));
  story.at(-26, 12, (run) => accept(run, 'core', id('mateo')));
  story.at(-25, 10, async (run) => {
    await decideApplication(await run.as('kai'), {
      applicationId: id('luca'),
      decision: 'reject',
      reason: 'No verifiable proof of work yet.',
      applicantMessage: 'Ship the beta and reapply after the cooldown. We would like to see it.',
    });
  });
  story.at(-20, 9, async (run) => {
    await withdrawApplication(await run.as('hana'), {
      reason: 'Finishing a portfolio piece first.',
    });
  });
}

/** Chapter 8 (21 days ago → now): the live queue staff will find in the dashboard. */
export function openApplicationQueue(story: Story): void {
  const ids = new Map<CastKey, string>();
  joinAt(story, 'member', 13);
  joinAt(story, 'tomas', 16);
  joinAt(story, 'freya', 11);
  joinAt(story, 'omar', 20);

  story.at(-10, 18, async (run) => {
    ids.set('tomas', await submit(run, 'tomas'));
  });
  story.at(-8, 12, async (run) => {
    ids.set('freya', await submit(run, 'freya'));
  });
  story.at(-7, 10, (run) =>
    review(
      run,
      'theo',
      ids.get('tomas')!,
      'interview',
      4,
      'Exceptional reasoning; building record thin.',
    ),
  );
  story.at(-5, 15, (run) =>
    review(
      run,
      'operations',
      ids.get('freya')!,
      'accept',
      4,
      'Real field data, carefully maintained.',
    ),
  );
  story.at(-4, 11, async (run) => {
    await scheduleInterview(await run.as('core'), {
      applicationId: ids.get('tomas')!,
      interviewAt: run.time(2, 17),
      applicantMessage: 'Voice channel: Interview Room. Bring one thing you built and use.',
    });
  });
  story.at(-3, 21, async (run) => {
    await submit(run, 'omar');
  });
  story.at(-2, 19, async (run) => {
    await getOrCreateDraft(await run.as('member'));
    const draft = draftFor('member');
    await updateDraft(await run.as('member'), {
      domainKey: draft.domainKey,
      motivation: draft.motivation,
      portfolioUrl: draft.portfolioUrl,
    });
  });
}
