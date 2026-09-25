/** JVLN rank system. See docs/SCORING.md §3. */

export type Rank = 'S' | 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F';

const MAJOR: { letter: 'A' | 'B' | 'C' | 'D'; from: number; to: number }[] = [
  { letter: 'A', from: 2.326, to: 3.09 },
  { letter: 'B', from: 1.645, to: 2.326 },
  { letter: 'C', from: 0.842, to: 1.645 },
  { letter: 'D', from: 0, to: 0.842 },
];

/** Lower z bound of each rank, highest first. */
export const RANK_THRESHOLDS: { rank: Rank; z: number }[] = [
  { rank: 'S', z: 3.09 },
  ...MAJOR.flatMap(({ letter, from, to }) => {
    const step = (to - from) / 3;
    return [
      { rank: `${letter}+` as Rank, z: from + 2 * step },
      { rank: letter as Rank, z: from + step },
      { rank: `${letter}-` as Rank, z: from },
    ];
  }),
  { rank: 'F', z: -Infinity },
];

/** Population share above each major threshold, from the product definition. */
export const RANK_TOP_SHARE: Record<'S' | 'A' | 'B' | 'C' | 'D', string> = { S: '0.1%', A: '1%', B: '5%', C: '20%', D: '50%' };

/** Future: a norm table maps θ to a population z. Absent today, so θ is used as a provisional z. */
export interface NormTable {
  id: string;
  toZ(theta: number): number;
}

export function rankFor(theta: number, norms?: NormTable): Rank {
  const z = norms ? norms.toZ(theta) : theta;
  return RANK_THRESHOLDS.find((t) => z >= t.z)!.rank;
}

export const rankIndex = (r: Rank) => RANK_THRESHOLDS.findIndex((t) => t.rank === r);

/** Display letters use a true minus sign. */
export const displayRank = (r: Rank) => r.replace('-', '−');

export const majorLetter = (r: Rank) => r[0] as 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
