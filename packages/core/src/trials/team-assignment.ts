import { createHash, randomBytes } from 'node:crypto';
import { NATO_ALPHABET, TEAM_NAME_PREFIX } from './constants';

/**
 * Pure, deterministic team assignment. Given the same candidates, team size,
 * strategy and seed, the result is identical — regardless of input order — so
 * every assignment can be reproduced from the seed recorded in the audit log.
 */

export const ASSIGNMENT_STRATEGIES = ['random', 'balanced'] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export interface AssignmentCandidate {
  memberId: string;
  /** Capability domain the member identifies with (null when unknown). */
  primaryDomain: string | null;
  /** Higher is preferred as team lead (e.g. VERIFIED above TRIAL). */
  leadPriority: number;
}

export interface PlannedTeam {
  ordinal: number;
  name: string;
  leadMemberId: string;
  /** Lead first, then the remaining members in dealt order. */
  memberIds: string[];
}

export interface PlanTeamsOptions {
  teamSize: number;
  strategy: AssignmentStrategy;
  seed: string;
}

const UNKNOWN_DOMAIN = '~unknown';
const SEED_BYTES = 12;
const UINT32_RANGE = 2 ** 32;

/** A fresh seed for callers that did not supply one. */
export function generateSeed(): string {
  return randomBytes(SEED_BYTES).toString('hex');
}

/** 'UNIT ALPHA', 'UNIT BRAVO', … 'UNIT ZULU', then 'UNIT ALPHA 2', … */
export function teamName(ordinal: number): string {
  const letter = NATO_ALPHABET[ordinal % NATO_ALPHABET.length]!;
  const cycle = Math.floor(ordinal / NATO_ALPHABET.length);
  return cycle === 0
    ? `${TEAM_NAME_PREFIX} ${letter}`
    : `${TEAM_NAME_PREFIX} ${letter} ${cycle + 1}`;
}

/**
 * Mulberry32 PRNG seeded from SHA-256(seed). Returns floats in [0, 1). The
 * shift/multiplier constants below are the published Mulberry32 constants.
 */
export function createRng(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

/** Fisher–Yates shuffle driven by `rng`. Does not mutate the input. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function sizeDeviation(count: number, teams: number, teamSize: number): number {
  return Math.max(
    Math.abs(Math.ceil(count / teams) - teamSize),
    Math.abs(Math.floor(count / teams) - teamSize),
  );
}

/**
 * Team sizes for `count` members at a target `teamSize`.
 *
 * The team count is ⌊count/teamSize⌋ or ⌈count/teamSize⌉ — whichever keeps
 * team sizes closest to the target (ties → fewer, larger teams). The
 * remainder is distributed one member per team, so sizes differ by at most
 * one and larger teams come first. Fewer members than `teamSize` form one team.
 */
export function planTeamSizes(count: number, teamSize: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  if (!Number.isInteger(teamSize) || teamSize < 1) throw new RangeError('teamSize must be ≥ 1');
  const fewer = Math.max(1, Math.floor(count / teamSize));
  const more = Math.max(1, Math.ceil(count / teamSize));
  const teams =
    sizeDeviation(count, fewer, teamSize) <= sizeDeviation(count, more, teamSize) ? fewer : more;
  const base = Math.floor(count / teams);
  const remainder = count % teams;
  return Array.from({ length: teams }, (_, i) => (i < remainder ? base + 1 : base));
}

/**
 * Order in which members are dealt to teams.
 * - random: a seeded shuffle of everyone.
 * - balanced: members grouped by primary domain (largest group first), each
 *   group shuffled. Dealing this order round-robin spreads every domain
 *   across teams: per domain, team counts differ by at most one.
 */
function dealOrder(
  candidates: readonly AssignmentCandidate[],
  strategy: AssignmentStrategy,
  rng: () => number,
): AssignmentCandidate[] {
  if (strategy === 'random') return seededShuffle(candidates, rng);
  const groups = new Map<string, AssignmentCandidate[]>();
  for (const candidate of candidates) {
    const key = candidate.primaryDomain ?? UNKNOWN_DOMAIN;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(
    ([keyA, a], [keyB, b]) => b.length - a.length || keyA.localeCompare(keyB),
  );
  return ordered.flatMap(([, group]) => seededShuffle(group, rng));
}

/**
 * Assign candidates to teams. Members are dealt round-robin in deal order, so
 * team i receives members i, i+k, i+2k, … — which yields exactly the sizes of
 * `planTeamSizes`. The lead is the member with the highest lead priority;
 * ties go to whoever was dealt first (seeded).
 */
export function planTeams(
  candidates: readonly AssignmentCandidate[],
  options: PlanTeamsOptions,
): PlannedTeam[] {
  const unique = new Map(candidates.map((c) => [c.memberId, c]));
  if (unique.size !== candidates.length) throw new RangeError('duplicate candidate');
  const sorted = [...unique.values()].sort((a, b) => a.memberId.localeCompare(b.memberId));
  const sizes = planTeamSizes(sorted.length, options.teamSize);
  if (sizes.length === 0) return [];
  const rng = createRng(`${options.strategy}:${options.seed}`);
  const order = dealOrder(sorted, options.strategy, rng);
  const buckets: AssignmentCandidate[][] = sizes.map(() => []);
  order.forEach((candidate, index) => buckets[index % sizes.length]!.push(candidate));
  return buckets.map((members, ordinal) => {
    let lead = members[0]!;
    for (const member of members) if (member.leadPriority > lead.leadPriority) lead = member;
    return {
      ordinal,
      name: teamName(ordinal),
      leadMemberId: lead.memberId,
      memberIds: [lead.memberId, ...members.filter((m) => m !== lead).map((m) => m.memberId)],
    };
  });
}
