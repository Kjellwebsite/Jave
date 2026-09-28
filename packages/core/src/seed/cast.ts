import type { OrgRole } from '../permissions/roles';

/**
 * The people of the development organization. Fictional; any resemblance is
 * accidental. The first six are the dashboard's dev-login personas (same
 * Discord IDs, usernames and display names as `apps/dashboard/server/auth/
 * dev-personas.ts`), so a dev login lands in a populated organization.
 */

export type DomainKey = 'mind' | 'create' | 'body' | 'life' | 'bio';
export type FacetKey =
  | 'mind.reasoning'
  | 'mind.knowledge'
  | 'mind.research'
  | 'create.technical'
  | 'create.creative'
  | 'create.projects'
  | 'body.physical'
  | 'life.business'
  | 'life.execution'
  | 'bio.optimization';
export type RankCode = 'F' | 'E' | 'D' | 'C' | 'B' | 'A' | 'S';

export interface CastMember {
  key: CastKey;
  discordId: string;
  username: string;
  displayName: string;
  headline: string;
  bio: string;
  primaryDomain: DomainKey;
  visibility: 'public' | 'members' | 'staff';
  /** Days before the anchor the member joined the server. */
  joinedDaysAgo: number;
  /** Roles held from the start (founding staff and founding cohort). */
  foundingRoles: readonly OrgRole[];
  /** Self-reported ranks (CLAIMED). */
  claims: Partial<Record<FacetKey, RankCode>>;
  /** Ranks an evaluator verified for founding members (VERIFIED). */
  verified: Partial<Record<FacetKey, RankCode>>;
  /** False leaves onboarding incomplete (a brand-new arrival). */
  onboarded: boolean;
}

const DISCORD_EPOCH_MS = 1_420_070_400_000n;
const SNOWFLAKE_TIMESTAMP_SHIFT = 22n;

/** A Discord-shaped ID whose embedded creation time is `createdAt`. */
export function snowflakeAt(createdAt: Date | string, sequence: number): string {
  const ms = BigInt(new Date(createdAt).getTime());
  return (((ms - DISCORD_EPOCH_MS) << SNOWFLAKE_TIMESTAMP_SHIFT) | BigInt(sequence)).toString();
}

export const CAST_KEYS = [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'member',
  'kai',
  'theo',
  'rhea',
  'mara',
  'sana',
  'aiko',
  'ilya',
  'noor',
  'leo',
  'jun',
  'elif',
  'mateo',
  'priya',
  'omar',
  'freya',
  'tomas',
  'luca',
  'hana',
  'zara',
  'ben',
  'iris',
] as const;
export type CastKey = (typeof CAST_KEYS)[number];

type CastInput = Omit<CastMember, 'key' | 'claims' | 'verified' | 'foundingRoles' | 'onboarded'> &
  Partial<Pick<CastMember, 'claims' | 'verified' | 'foundingRoles' | 'onboarded'>>;

const CAST_INPUT: Record<CastKey, CastInput> = {
  founder: {
    discordId: '100000000000000001',
    username: 'dev_founder',
    displayName: 'Dev Founder',
    headline: 'Founder. Sets the bar, then raises it.',
    bio: 'Started JAVELIN to find people who ship under pressure and verify it in the open.',
    primaryDomain: 'life',
    visibility: 'public',
    joinedDaysAgo: 150,
    foundingRoles: ['founder'],
    claims: { 'life.execution': 'A', 'life.business': 'A', 'mind.reasoning': 'A' },
  },
  core: {
    discordId: '100000000000000002',
    username: 'dev_core',
    displayName: 'Dev Core',
    headline: 'Evaluations, ranks and the standards behind them.',
    bio: 'Runs the evaluator bench. Asks for evidence before opinions.',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 148,
    foundingRoles: ['core'],
    claims: { 'mind.reasoning': 'A', 'mind.research': 'B' },
  },
  operations: {
    discordId: '100000000000000003',
    username: 'dev_operations',
    displayName: 'Dev Operations',
    headline: 'Trials, missions and the calendar. Keeps the machine running.',
    bio: 'Schedules the trials, reviews the applications, closes the loops.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 140,
    foundingRoles: ['operations'],
    claims: { 'life.execution': 'B', 'create.projects': 'B' },
  },
  moderator: {
    discordId: '100000000000000004',
    username: 'dev_moderator',
    displayName: 'Dev Moderator',
    headline: 'Safety, tickets and a calm server.',
    bio: 'First responder for tickets and security events.',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 132,
    foundingRoles: ['moderator'],
    claims: { 'mind.knowledge': 'B' },
  },
  verified: {
    discordId: '100000000000000005',
    username: 'dev_verified',
    displayName: 'Dev Verified',
    headline: 'Backend engineer. Passed the 48-Hour Ship.',
    bio: 'Builds data pipelines for small labs. Prefers boring technology that works.',
    primaryDomain: 'create',
    visibility: 'public',
    joinedDaysAgo: 110,
    claims: { 'create.technical': 'B', 'create.projects': 'B', 'mind.knowledge': 'C' },
  },
  member: {
    discordId: '100000000000000006',
    username: 'dev_member',
    displayName: 'Dev Member',
    headline: 'Designer learning to ship end to end.',
    bio: 'Product designer moving into front-end. Application in progress.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 21,
    claims: { 'create.creative': 'B' },
  },
  kai: {
    discordId: snowflakeAt('2018-04-11T09:30:00Z', 7),
    username: 'kai',
    displayName: 'Kai Moreno',
    headline: 'Security and infrastructure. Core team.',
    bio: 'Incident commander by day. Writes the runbooks nobody else wants to.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 146,
    foundingRoles: ['core'],
    claims: { 'create.technical': 'A', 'life.execution': 'B' },
  },
  theo: {
    discordId: snowflakeAt('2019-09-02T17:10:00Z', 11),
    username: 'theo',
    displayName: 'Theo Lindqvist',
    headline: 'Runs trials and evaluations.',
    bio: 'Former debate coach. Designs rubrics that measure outcomes, not effort.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 138,
    foundingRoles: ['operations'],
    claims: { 'mind.reasoning': 'B', 'life.execution': 'B' },
  },
  rhea: {
    discordId: snowflakeAt('2020-01-19T12:00:00Z', 3),
    username: 'rhea',
    displayName: 'Rhea Sato',
    headline: 'Moderation and member support.',
    bio: 'Keeps the signal-to-noise ratio high without raising her voice.',
    primaryDomain: 'bio',
    visibility: 'members',
    joinedDaysAgo: 128,
    foundingRoles: ['moderator'],
    claims: { 'bio.optimization': 'B' },
  },
  mara: {
    discordId: snowflakeAt('2017-06-23T08:45:00Z', 5),
    username: 'mara',
    displayName: 'Mara Voss',
    headline: 'Flight software for small satellites. Ships on schedule.',
    bio: 'Leads the attitude-control stack for a student cubesat programme. Two launches, zero missed windows.',
    primaryDomain: 'create',
    visibility: 'public',
    joinedDaysAgo: 145,
    foundingRoles: ['verified'],
    claims: { 'body.physical': 'B', 'bio.optimization': 'B' },
    verified: { 'create.technical': 'S', 'create.projects': 'A', 'mind.reasoning': 'A' },
  },
  sana: {
    discordId: snowflakeAt('2019-02-14T15:20:00Z', 9),
    username: 'sana',
    displayName: 'Sana Okafor',
    headline: 'Computational biology. Peer-reviewed at nineteen.',
    bio: 'Models circadian rhythms. Reads methods sections first.',
    primaryDomain: 'mind',
    visibility: 'public',
    joinedDaysAgo: 144,
    foundingRoles: ['verified'],
    claims: { 'mind.reasoning': 'A' },
    verified: { 'mind.research': 'A', 'mind.knowledge': 'B', 'bio.optimization': 'B' },
  },
  aiko: {
    discordId: snowflakeAt('2020-07-30T21:05:00Z', 2),
    username: 'aiko',
    displayName: 'Aiko Tanaka',
    headline: 'Rower and sports scientist.',
    bio: 'National junior rowing squad. Builds training-load models for her crew.',
    primaryDomain: 'body',
    visibility: 'public',
    joinedDaysAgo: 142,
    foundingRoles: ['verified'],
    claims: { 'body.physical': 'A', 'create.technical': 'C' },
    verified: { 'body.physical': 'B', 'bio.optimization': 'B' },
  },
  ilya: {
    discordId: snowflakeAt('2018-11-05T10:15:00Z', 4),
    username: 'ilya',
    displayName: 'Ilya Brenner',
    headline: 'Distributed systems. Distinction at the 48-Hour Ship.',
    bio: 'Builds consensus protocols for fun and grant trackers for money.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 108,
    claims: { 'create.technical': 'A', 'mind.knowledge': 'B' },
  },
  noor: {
    discordId: snowflakeAt('2021-03-08T13:40:00Z', 6),
    username: 'noor',
    displayName: 'Noor Haddad',
    headline: 'Operator. Turns messy teams into shipping teams.',
    bio: 'Ran logistics for a student relief network across three cities.',
    primaryDomain: 'life',
    visibility: 'public',
    joinedDaysAgo: 106,
    claims: { 'life.execution': 'A', 'life.business': 'B' },
  },
  leo: {
    discordId: snowflakeAt('2020-10-12T06:25:00Z', 8),
    username: 'leo',
    displayName: 'Leo Varga',
    headline: 'Hardware hacker. Solders before breakfast.',
    bio: 'Builds sensor rigs for field biologists.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 104,
    claims: { 'create.technical': 'B', 'create.creative': 'C' },
  },
  jun: {
    discordId: snowflakeAt('2021-12-01T11:11:00Z', 12),
    username: 'jun',
    displayName: 'Jun Park',
    headline: 'Economics student. Models markets that do not exist yet.',
    bio: 'Writes agent-based simulations of emerging markets.',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 40,
    claims: { 'mind.reasoning': 'B', 'life.business': 'B' },
  },
  elif: {
    discordId: snowflakeAt('2022-05-17T19:45:00Z', 1),
    username: 'elif',
    displayName: 'Elif Demir',
    headline: 'Science writer. Makes hard papers readable.',
    bio: 'Edits a student research journal. Fact-checks everything twice.',
    primaryDomain: 'mind',
    visibility: 'public',
    joinedDaysAgo: 38,
    claims: { 'mind.research': 'B', 'create.creative': 'B' },
  },
  mateo: {
    discordId: snowflakeAt('2021-08-26T07:30:00Z', 10),
    username: 'mateo',
    displayName: 'Mateo Silva',
    headline: 'Robotics. Competes, then open-sources the robot.',
    bio: 'Captain of a school robotics team; two regional titles.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 36,
    claims: { 'create.technical': 'B', 'create.projects': 'B' },
  },
  priya: {
    discordId: snowflakeAt('2020-04-03T16:00:00Z', 13),
    username: 'priya',
    displayName: 'Priya Raman',
    headline: 'Data analyst. Second attempt at the Gauntlet.',
    bio: 'Learned more from failing the first trial than from passing anything else.',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 102,
    claims: { 'mind.knowledge': 'B', 'create.technical': 'C' },
  },
  omar: {
    discordId: snowflakeAt('2022-09-09T09:09:00Z', 14),
    username: 'omar',
    displayName: 'Omar Farouk',
    headline: 'Founder of a campus delivery co-op.',
    bio: 'Grew a delivery co-op to forty riders. Wants a sharper peer group.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 12,
    claims: { 'life.business': 'B', 'life.execution': 'B' },
  },
  freya: {
    discordId: snowflakeAt('2021-01-27T14:50:00Z', 15),
    username: 'freya',
    displayName: 'Freya Nilsen',
    headline: 'Marine biology. Field data, not slides.',
    bio: 'Tags seabirds in the Arctic every summer.',
    primaryDomain: 'bio',
    visibility: 'members',
    joinedDaysAgo: 16,
    claims: { 'mind.research': 'C', 'body.physical': 'B' },
  },
  tomas: {
    discordId: snowflakeAt('2019-05-21T18:35:00Z', 16),
    username: 'tomas',
    displayName: 'Tomas Kral',
    headline: 'Competitive programmer.',
    bio: 'Two regional olympiad medals. Learning to build things people use.',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 18,
    claims: { 'mind.reasoning': 'A', 'create.technical': 'B' },
  },
  luca: {
    discordId: snowflakeAt('2022-02-02T12:12:00Z', 17),
    username: 'luca',
    displayName: 'Luca Bianchi',
    headline: 'Aspiring founder.',
    bio: 'Building a note-taking app. Will reapply once it ships.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 30,
    claims: { 'life.business': 'A' },
  },
  hana: {
    discordId: snowflakeAt('2021-06-06T06:06:00Z', 18),
    username: 'hana',
    displayName: 'Hana Ito',
    headline: 'Illustrator and motion designer.',
    bio: 'Paused her application to finish a portfolio piece.',
    primaryDomain: 'create',
    visibility: 'members',
    joinedDaysAgo: 26,
    claims: { 'create.creative': 'A' },
  },
  zara: {
    discordId: snowflakeAt('2023-03-15T10:00:00Z', 19),
    username: 'zara',
    displayName: 'Zara Quinn',
    headline: '',
    bio: '',
    primaryDomain: 'mind',
    visibility: 'members',
    joinedDaysAgo: 1,
    onboarded: false,
  },
  ben: {
    discordId: snowflakeAt('2023-01-10T22:40:00Z', 20),
    username: 'ben',
    displayName: 'Ben Adler',
    headline: 'Crypto trader.',
    bio: 'Here for the network.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 9,
    claims: { 'life.business': 'S' },
  },
  iris: {
    discordId: snowflakeAt('2018-08-18T08:18:00Z', 21),
    username: 'iris',
    displayName: 'Iris Calder',
    headline: 'Patron. Funds the hardware budget.',
    bio: 'Engineer turned angel investor. Supports JAVELIN; does not compete.',
    primaryDomain: 'life',
    visibility: 'members',
    joinedDaysAgo: 120,
    foundingRoles: ['supporter'],
  },
};

export const CAST: readonly CastMember[] = CAST_KEYS.map((key) => ({
  key,
  claims: {},
  verified: {},
  foundingRoles: [],
  onboarded: true,
  ...CAST_INPUT[key],
}));

export function castMember(key: CastKey): CastMember {
  return CAST.find((member) => member.key === key)!;
}

/** The dev-login personas, in the dashboard's order. */
export const PERSONA_KEYS = [
  'founder',
  'core',
  'operations',
  'moderator',
  'verified',
  'member',
] as const satisfies readonly CastKey[];
