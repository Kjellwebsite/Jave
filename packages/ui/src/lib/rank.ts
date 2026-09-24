/**
 * Rank presentation. A rank is always shown with its epistemic status:
 * VERIFIED (evaluator-set, solid), CLAIMED (self-reported, outlined and dim)
 * or UNKNOWN (no data, a dash). Never blended into a single score.
 */
export type RankStatus = 'verified' | 'claimed' | 'unknown';

export interface RankInput {
  verifiedRank?: string | null;
  claimedRank?: string | null;
}

export interface RankDisplay {
  status: RankStatus;
  /** The rank code shown (verified wins over claimed), or null when unknown. */
  rank: string | null;
  /** Glyph rendered in the plate. */
  glyph: string;
  label: 'VERIFIED' | 'CLAIMED' | 'UNKNOWN';
  /** Screen-reader text, e.g. "Rank A, verified". */
  ariaLabel: string;
}

export const UNKNOWN_GLYPH = '—';
const MAX_RANK_CODE_LENGTH = 4;

function normalize(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  return trimmed.length > 0 && trimmed.length <= MAX_RANK_CODE_LENGTH ? trimmed : null;
}

export function describeRank(input: RankInput): RankDisplay {
  const verified = normalize(input.verifiedRank);
  if (verified) {
    return {
      status: 'verified',
      rank: verified,
      glyph: verified,
      label: 'VERIFIED',
      ariaLabel: `Rank ${verified}, verified`,
    };
  }
  const claimed = normalize(input.claimedRank);
  if (claimed) {
    return {
      status: 'claimed',
      rank: claimed,
      glyph: claimed,
      label: 'CLAIMED',
      ariaLabel: `Rank ${claimed}, claimed, not verified`,
    };
  }
  return {
    status: 'unknown',
    rank: null,
    glyph: UNKNOWN_GLYPH,
    label: 'UNKNOWN',
    ariaLabel: 'Rank unknown',
  };
}
