/**
 * End-to-end fixtures for /ai and /research — TEST DATA ONLY. Written through
 * the core services so ledger rows, proposals, reviews and audit entries are
 * genuine. The AI provider is the MOCK / DEVELOPMENT ONLY MockProvider.
 */
import { MockProvider } from '@jave/ai';
import {
  ai,
  createContext,
  findUserByDiscordId,
  research,
  resolveUserActor,
  type ServiceContext,
  systemActor,
  updateSettings,
  withActor,
} from '@jave/core';
import { createDatabase } from '@jave/database';
import { DEV_PERSONAS } from '../server/auth/dev-personas';

/** Fictional announcements channel id (never a real Discord channel). */
const ANNOUNCEMENTS_CHANNEL = '300000000000000042';

/** The research references the library starts with (fictional reviews of real papers). */
export const SEEDED_PAPERS = {
  numpy: 'Array programming with NumPy',
  alphafold: 'Highly accurate protein structure prediction with AlphaFold',
  sleep: 'Sleep and memory consolidation',
} as const;

const MISSION_DRAFT = JSON.stringify({
  title: 'Decode the CubeSat beacon',
  brief:
    'Parse the beacon frame format and publish decoded telemetry. Completion is verified by a live demo against a recorded pass.',
  type: 'build',
});
const ANNOUNCEMENT_DRAFT = JSON.stringify({
  title: 'Autumn trials open',
  body: 'Trials open Monday 18:00 UTC. Read the brief in the trials channel before you apply. Applications close Sunday.',
});

async function contextFor(system: ServiceContext, discordId: string): Promise<ServiceContext> {
  const user = await findUserByDiscordId(system, discordId);
  if (!user) throw new Error(`e2e fixture user ${discordId} is missing`);
  return withActor(system, await resolveUserActor(system, user.id));
}

function personaDiscordId(key: string): string {
  const persona = DEV_PERSONAS.find((candidate) => candidate.key === key);
  if (!persona) throw new Error(`unknown persona ${key}`);
  return persona.discordId;
}

export async function seedAiResearchFixtures(databaseUrl: string): Promise<void> {
  const database = createDatabase(databaseUrl, { max: 2, applicationName: 'jave-e2e-ai-seed' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-seed') });
  try {
    const founder = await contextFor(system, personaDiscordId('founder'));
    const core = await contextFor(system, personaDiscordId('core'));
    const operations = await contextFor(system, personaDiscordId('operations'));
    const verified = await contextFor(system, personaDiscordId('verified'));
    const member = await contextFor(system, personaDiscordId('member'));
    const mara = await contextFor(system, '110000000000000011');
    const sana = await contextFor(system, '110000000000000013');
    await updateSettings(founder, 'channels', { announcements: ANNOUNCEMENTS_CHANNEL });

    // Ledger and usage: a few answered requests from different members and surfaces.
    const answers = { provider: new MockProvider() };
    await ai.ask(mara, answers, { question: 'What makes a good ground-station schedule?' });
    await ai.research(sana, answers, { question: 'Does sleep help memory consolidation?' });
    await ai.summarize(member, answers, {
      text: 'Notes from the trial briefing: build, document, defend.',
      surface: 'dashboard',
    });
    await ai.brainstorm(verified, answers, { topic: 'Cheap satellite ground stations' });

    // Proposals: pending drafts by other staff, for the founder's confirmation queue.
    await ai.draftTask(operations, { provider: new MockProvider({ respond: () => MISSION_DRAFT }) }, {
      brief: 'Someone should decode the beacon frames from the last pass.',
    });
    await ai.draftAnnouncement(
      core,
      { provider: new MockProvider({ respond: () => ANNOUNCEMENT_DRAFT }) },
      { brief: 'Announce the autumn trials.', surface: 'dashboard' },
    );

    // Research library: saved, reviewed and verified by different members.
    const numpy = await research.saveResearchItem(mara, {
      title: SEEDED_PAPERS.numpy,
      authors: ['Harris, C. R.', 'Millman, K. J.', 'van der Walt, S. J.'],
      doi: '10.1038/s41586-020-2649-2',
      source: 'Nature',
      publishedOn: '2020-09-16',
      topic: 'Scientific computing',
      tags: ['python', 'arrays'],
      summary: 'The design of NumPy and why array programming underpins scientific Python.',
    });
    const alphafold = await research.saveResearchItem(sana, {
      title: SEEDED_PAPERS.alphafold,
      authors: ['Jumper, J.', 'Evans, R.', 'Pritzel, A.'],
      doi: '10.1038/s41586-021-03819-2',
      source: 'Nature',
      publishedOn: '2021-07-15',
      topic: 'Structural biology',
      tags: ['protein folding'],
    });
    await research.saveResearchItem(verified, {
      title: SEEDED_PAPERS.sleep,
      url: 'https://example.org/sleep-memory-review',
      topic: 'Neuroscience',
    });
    const reviewed = await research.reviewResearchItem(operations, {
      itemId: numpy.item.id,
      expectedVersion: numpy.item.version,
      status: 'verified',
      evidenceLevel: 'peer_reviewed',
      note: 'Published, widely replicated.',
    });
    await research.reviewResearchItem(operations, {
      itemId: alphafold.item.id,
      expectedVersion: alphafold.item.version,
      status: 'reviewed',
      evidenceLevel: 'experimental',
    });
    await research.requestSidusSync(founder, { itemId: reviewed.id });
  } finally {
    await database.close();
  }
}
