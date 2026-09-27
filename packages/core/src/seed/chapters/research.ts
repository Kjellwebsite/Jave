import * as research from '../../research';
import type { CastKey } from '../cast';
import type { SeedRun } from '../run';
import type { Story } from '../story';

/**
 * The SIDUS SCIENCE library: items verified (Sana's three unlock
 * RESEARCHER), one reviewed, two awaiting review. DOIs use the 10.5555
 * test prefix and URLs the example.org domain, so nothing points at a real
 * paper or person.
 */

type EvidenceLevel =
  'anecdotal' | 'observational' | 'experimental' | 'peer_reviewed' | 'meta_analysis';

interface ItemPlan {
  submitter: CastKey;
  day: number;
  hour: number;
  input: Parameters<typeof research.saveResearchItem>[1];
  review?: {
    reviewer: CastKey;
    day: number;
    status: 'reviewed' | 'verified';
    evidenceLevel: EvidenceLevel;
    note: string;
  };
}

const ITEMS: readonly ItemPlan[] = [
  {
    submitter: 'sana',
    day: -66,
    hour: 14,
    input: {
      title: 'Sleep spindles and overnight memory consolidation: a preregistered replication',
      authors: ['A. Lindgren', 'M. Osei', 'R. Castellanos'],
      source: 'Journal of Sleep Methods',
      doi: '10.5555/jsm.2024.0172',
      topic: 'sleep',
      tags: ['memory', 'replication', 'preregistered'],
      summary: 'Replicates the spindle–recall link at a third of the original effect size.',
      publishedOn: '2024-03-11',
    },
    review: {
      reviewer: 'theo',
      day: -64,
      status: 'verified',
      evidenceLevel: 'experimental',
      note: 'Preregistration matches the analysis. Effect smaller than the original, as stated.',
    },
  },
  {
    submitter: 'sana',
    day: -58,
    hour: 10,
    input: {
      title: 'Napping and declarative memory: a meta-analysis of 41 trials',
      authors: ['K. Havel', 'S. Imamura'],
      source: 'Sleep Evidence Review',
      doi: '10.5555/ser.2023.0418',
      topic: 'sleep',
      tags: ['napping', 'meta-analysis'],
      summary: 'Short naps show a small, consistent benefit; heterogeneity is high.',
      publishedOn: '2023-09-02',
    },
    review: {
      reviewer: 'core',
      day: -57,
      status: 'verified',
      evidenceLevel: 'meta_analysis',
      note: 'Search strategy and bias assessment are sound.',
    },
  },
  {
    submitter: 'sana',
    day: -40,
    hour: 16,
    input: {
      title: 'Circadian misalignment in adolescents: a cohort study',
      authors: ['D. Moreau', 'L. Achebe'],
      source: 'Chronobiology Quarterly',
      doi: '10.5555/cq.2022.0093',
      topic: 'sleep',
      tags: ['circadian', 'adolescents', 'cohort'],
      summary: 'Later school starts track with better sleep; confounding by season remains.',
      publishedOn: '2022-11-20',
    },
    review: {
      reviewer: 'theo',
      day: -38,
      status: 'verified',
      evidenceLevel: 'observational',
      note: 'Observational; the confounders are named honestly.',
    },
  },
  {
    submitter: 'mara',
    day: -90,
    hour: 12,
    input: {
      title: 'Magnetorquer sizing for 3U cubesats',
      authors: ['J. Okonkwo'],
      source: 'Small Satellite Engineering Notes',
      url: 'https://library.example.org/notes/magnetorquer-sizing',
      topic: 'spacecraft',
      tags: ['adcs', 'cubesat'],
      summary: 'Worked sizing method with margins; matches Helios bench data within 8%.',
      publishedOn: '2021-06-15',
    },
    review: {
      reviewer: 'kai',
      day: -88,
      status: 'verified',
      evidenceLevel: 'peer_reviewed',
      note: 'Method checked against our own bench measurements.',
    },
  },
  {
    submitter: 'elif',
    day: -25,
    hour: 16,
    input: {
      title: 'Why most sleep-hacking claims fail replication',
      authors: ['Elif Demir'],
      source: 'Student Research Review',
      url: 'https://journal.example.org/essays/sleep-hacking',
      topic: 'sleep',
      tags: ['replication', 'science communication'],
      summary: 'Essay tracing five popular sleep claims back to their primary sources.',
    },
    review: {
      reviewer: 'operations',
      day: -23,
      status: 'reviewed',
      evidenceLevel: 'anecdotal',
      note: 'Useful synthesis; an essay, not evidence on its own.',
    },
  },
  {
    submitter: 'jun',
    day: -6,
    hour: 19,
    input: {
      title: 'Informal credit networks under interest-rate shocks',
      authors: ['P. Anand', 'T. Werner'],
      source: 'Development Economics Letters',
      doi: '10.5555/del.2022.0441',
      topic: 'economics',
      tags: ['credit', 'simulation'],
    },
  },
  {
    submitter: 'verified',
    day: -1,
    hour: 21,
    input: {
      title: 'Idempotent job queues on Postgres',
      source: 'Engineering notes',
      url: 'https://engineering.example.org/idempotent-queues',
      topic: 'systems',
      tags: ['postgres', 'queues'],
      summary: 'SKIP LOCKED, dedupe keys and why exactly-once is a property of handlers.',
    },
  },
];

async function reviewItem(run: SeedRun, itemId: string, review: NonNullable<ItemPlan['review']>) {
  const current = await research.getResearchItem(await run.as(review.reviewer), { itemId });
  await research.reviewResearchItem(await run.as(review.reviewer), {
    itemId,
    expectedVersion: current.version,
    status: review.status,
    evidenceLevel: review.evidenceLevel,
    note: review.note,
  });
}

export function buildLibrary(story: Story): void {
  for (const plan of ITEMS) {
    let itemId = '';
    story.at(plan.day, plan.hour, async (run) => {
      const { item } = await research.saveResearchItem(await run.as(plan.submitter), plan.input);
      itemId = item.id;
    });
    const review = plan.review;
    if (review) story.at(review.day, 10, (run) => reviewItem(run, itemId, review));
  }
}
