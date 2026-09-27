/**
 * Applications & verification end-to-end fixtures — TEST DATA ONLY.
 * Fictional applicants and verification requests in every state the pages
 * render, written through the core services (so status history, reviews,
 * audit and card jobs are genuine). Run by workflow-applications.spec.ts
 * after the shared seed; refuses any database whose name lacks "e2e" and
 * does nothing when the fixtures already exist.
 */
import { eq } from 'drizzle-orm';
import {
  applications,
  createContext,
  DAY,
  resolveUserActor,
  type ServiceContext,
  setVerifiedRank,
  syncDiscordUser,
  systemActor,
  grantRoleUnchecked,
  type OrgRole,
  verification,
  withActor,
} from '@jave/core';
import {
  applications as applicationRows,
  contributions,
  createDatabase,
  projectMembers,
  projects,
  users,
} from '@jave/database';
import { DEV_PERSONAS } from '../server/auth/dev-personas';

const E2E_DATABASE_NAME = /e2e/i;

/** A dev-login persona's Discord id (see server/auth/dev-personas.ts). */
function personaDiscordId(key: 'founder' | 'core' | 'operations'): string {
  const persona = DEV_PERSONAS.find((candidate) => candidate.key === key);
  if (!persona) throw new Error(`dev persona ${key} missing`);
  return persona.discordId;
}

interface Person {
  discordId: string;
  username: string;
  displayName: string;
  roles: OrgRole[];
}

const PEOPLE = {
  vera: {
    discordId: '120000000000000001',
    username: 'vera',
    displayName: 'Vera Lind',
    roles: [],
  },
  omar: {
    discordId: '120000000000000002',
    username: 'omar',
    displayName: 'Omar Castillo',
    roles: [],
  },
  hana: { discordId: '120000000000000003', username: 'hana', displayName: 'Hana Sato', roles: [] },
  luca: {
    discordId: '120000000000000004',
    username: 'luca',
    displayName: 'Luca Brandt',
    roles: [],
  },
  tomas: {
    discordId: '120000000000000005',
    username: 'tomas',
    displayName: 'Tomas Reyes',
    roles: ['trial'],
  },
  aiko: {
    discordId: '120000000000000006',
    username: 'aiko',
    displayName: 'Aiko Mori',
    roles: ['verified'],
  },
  zane: {
    discordId: '120000000000000007',
    username: 'zane',
    displayName: 'Zane Okoye',
    roles: ['trial'],
  },
} as const satisfies Record<string, Person>;

const ANSWERS: Readonly<Record<'vera' | 'omar' | 'hana' | 'luca', applications.UpdateDraftInput>> =
  {
    vera: {
      domainKey: 'create',
      motivation:
        'I build firmware for open-source prosthetic hands and want peers who ship under real constraints.',
      experience:
        'Three years maintaining a motor-control library used by two university labs; led the 2025 rewrite.',
      projects:
        'Grip controller (MIT licensed), 40k downloads. A tendon-tension sensor board, second revision.',
      portfolioUrl: 'https://example.org/vera',
      evidenceLinks: ['https://github.com/example/grip', 'https://example.org/vera/talk'],
      references: 'Dr. Ines Alvarez, lab lead — ines@example.org',
    },
    omar: {
      domainKey: 'mind',
      motivation:
        'I want to be measured against people who publish, not people who post. Research is my track.',
      experience:
        'Undergraduate thesis on sparse attention, accepted at a workshop; two replication studies.',
      projects: 'Replication of three efficiency papers with released code and negative results.',
      evidenceLinks: ['https://arxiv.org/abs/0000.00000'],
    },
    hana: {
      domainKey: 'body',
      motivation:
        'National-level rower moving into sports science; I want a room that holds both disciplines.',
      experience:
        'Seven years of competitive rowing, two national finals; coaching a junior squad since 2024.',
      projects: 'Built a stroke-rate analysis tool from phone IMU data for my squad.',
    },
    luca: {
      domainKey: 'life',
      motivation: 'I want to grow my network and learn from people more ambitious than me here.',
      experience:
        'Started two side projects this year and read widely about startups and investing.',
      portfolioUrl: 'https://example.org/luca',
    },
  };

async function actorFor(system: ServiceContext, discordId: string): Promise<ServiceContext> {
  const [user] = await system.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, discordId));
  if (!user) throw new Error(`fixture user ${discordId} missing — run the shared seed first`);
  return withActor(system, await resolveUserActor(system, user.id));
}

async function person(system: ServiceContext, fixture: Person): Promise<ServiceContext> {
  const { member } = await syncDiscordUser(
    system,
    { discordId: fixture.discordId, username: fixture.username, displayName: fixture.displayName },
    { inGuild: true },
  );
  for (const role of fixture.roles)
    await grantRoleUnchecked(system, { memberId: member.id, role, reason: 'e2e fixture' });
  return actorFor(system, fixture.discordId);
}

async function submitted(
  ctx: ServiceContext,
  answers: applications.UpdateDraftInput,
): Promise<string> {
  const { application } = await applications.getOrCreateDraft(ctx);
  await applications.updateDraft(ctx, answers);
  await applications.submitApplication(ctx);
  return application.id;
}

async function seedApplications(system: ServiceContext, staff: Record<string, ServiceContext>) {
  const vera = await person(system, PEOPLE.vera);
  await submitted(vera, ANSWERS.vera);

  const omar = await person(system, PEOPLE.omar);
  const omarId = await submitted(omar, ANSWERS.omar);
  await applications.startReview(staff.operations!, { applicationId: omarId });
  await applications.reviewApplication(staff.operations!, {
    applicationId: omarId,
    recommendation: 'accept',
    score: 4,
    note: 'Replications are careful and the negative results are honest.',
  });

  const hana = await person(system, PEOPLE.hana);
  const hanaId = await submitted(hana, ANSWERS.hana);
  await applications.reviewApplication(staff.core!, {
    applicationId: hanaId,
    recommendation: 'interview',
    score: 3,
    note: 'Promising. Want to hear how the analysis tool was validated.',
  });
  await applications.scheduleInterview(staff.founder!, {
    applicationId: hanaId,
    interviewAt: new Date(system.clock.now().getTime() + 2 * DAY),
    applicantMessage: 'Voice channel: Briefing Room.',
  });

  const luca = await person(system, PEOPLE.luca);
  const lucaId = await submitted(luca, ANSWERS.luca);
  await applications.reviewApplication(staff.core!, {
    applicationId: lucaId,
    recommendation: 'reject',
    score: 1,
    note: 'No proof of work yet.',
  });
  await applications.decideApplication(staff.founder!, {
    applicationId: lucaId,
    decision: 'reject',
    reason: 'No demonstrated work; motivation is networking.',
    applicantMessage: 'Ship something you can show us, then apply again.',
  });

  const operations = staff.operations!;
  if (operations.actor.kind !== 'user') throw new Error('operations persona is not a user');
  await system.db.insert(applicationRows).values({
    userId: operations.actor.userId,
    status: 'submitted',
    domainKey: 'life',
    motivation: 'Fixture: a staff member with their own application (conflict of interest).',
    submittedAt: system.clock.now(),
  });
}

async function seedVerifications(system: ServiceContext, staff: Record<string, ServiceContext>) {
  const tomas = await person(system, PEOPLE.tomas);
  await verification.requestVerification(tomas, {
    target: { type: 'identity' },
    claim: 'I am the Tomas Reyes who presented at the regional robotics finals.',
    evidence: [{ title: 'Finals programme', url: 'https://example.org/finals-2026' }],
  });

  const aiko = await person(system, PEOPLE.aiko);
  const aikoMember = aiko.actor.kind === 'user' ? aiko.actor.memberId! : '';
  // Already verified at C: an approval can only grant B or higher.
  await setVerifiedRank(staff.core!, {
    memberId: aikoMember,
    facetKey: 'create.technical',
    rank: 'C',
    reason: 'Fixture: evaluated in a build trial.',
  });
  await verification.requestVerification(aiko, {
    target: { type: 'skill', facetKey: 'create.technical', requestedRank: 'A' },
    claim: 'Designed and shipped the flight computer for a student rocket, end to end.',
    evidence: [
      { title: 'Flight computer repository', url: 'https://github.com/example/flight' },
      { title: 'Launch report', url: 'https://example.org/launch-report' },
    ],
  });
  const [contribution] = await system.db
    .insert(contributions)
    .values({
      memberId: aikoMember,
      kind: 'code',
      title: 'Telemetry parser rewrite',
      status: 'submitted',
    })
    .returning({ id: contributions.id });
  const approved = await verification.requestVerification(aiko, {
    target: { type: 'contribution', contributionId: contribution!.id },
  });
  await verification.decideVerification(staff.operations!, {
    verificationId: approved.id,
    decision: 'approve',
    note: 'Merged upstream; the diff matches the claim.',
  });

  const zane = await person(system, PEOPLE.zane);
  const zaneMember = zane.actor.kind === 'user' ? zane.actor.memberId! : '';
  const [project] = await system.db
    .insert(projects)
    .values({ slug: 'e2e-ground-station', title: 'Ground station', ownerMemberId: zaneMember })
    .returning({ id: projects.id });
  await system.db
    .insert(projectMembers)
    .values({ projectId: project!.id, memberId: zaneMember, role: 'owner' });
  const inReview = await verification.requestVerification(zane, {
    target: { type: 'project', projectId: project!.id },
  });
  await verification.startReview(staff.operations!, { verificationId: inReview.id });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!E2E_DATABASE_NAME.test(name)) throw new Error(`refusing to seed "${name}"`);
  const database = createDatabase(url, { max: 2, applicationName: 'jave-e2e-applications' });
  const system = createContext({ db: database.db, actor: systemActor('e2e-applications') });
  try {
    const [existing] = await system.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, PEOPLE.vera.discordId));
    if (existing) {
      console.log('applications fixtures already present');
      return;
    }
    const staff = {
      founder: await actorFor(system, personaDiscordId('founder')),
      core: await actorFor(system, personaDiscordId('core')),
      operations: await actorFor(system, personaDiscordId('operations')),
    };
    await seedApplications(system, staff);
    await seedVerifications(system, staff);
    console.log('applications fixtures ready');
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('applications fixtures failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
