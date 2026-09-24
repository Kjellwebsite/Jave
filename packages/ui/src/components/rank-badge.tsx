import { cx } from '../lib/cx';
import { describeRank, type RankInput, type RankStatus } from '../lib/rank';

export type RankBadgeSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const PLATE_SIZE: Record<RankBadgeSize, string> = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-[11px]',
  md: 'size-8 text-[14px]',
  lg: 'size-11 text-[19px]',
  xl: 'size-16 text-[28px]',
};

const STATUS_CLASS: Record<RankStatus, string> = {
  verified: 'rank-verified',
  claimed: 'rank-claimed',
  unknown: 'rank-unknown',
};

const LABEL_CLASS: Record<RankStatus, string> = {
  verified: 'text-fg',
  claimed: 'text-fg-subtle',
  unknown: 'text-fg-subtle',
};

export interface RankBadgeProps extends RankInput {
  size?: RankBadgeSize;
  /**
   * `auto` (default) labels CLAIMED and UNKNOWN — the states that must never
   * be mistaken for a verified rank. `always` also labels VERIFIED.
   */
  label?: 'auto' | 'always' | 'none';
  className?: string;
}

/** A rank letter as a machined plate. VERIFIED solid chrome · CLAIMED dashed · UNKNOWN dash. */
export function RankBadge({
  verifiedRank,
  claimedRank,
  size = 'md',
  label = 'auto',
  className,
}: RankBadgeProps) {
  const rank = describeRank({ verifiedRank, claimedRank });
  const showLabel = label === 'always' || (label === 'auto' && rank.status !== 'verified');
  return (
    <span
      role="img"
      aria-label={rank.ariaLabel}
      data-rank-status={rank.status}
      className={cx('inline-flex items-center gap-2 align-middle', className)}
    >
      <span
        aria-hidden
        className={cx(
          'inline-flex shrink-0 items-center justify-center rounded-sm font-display font-semibold leading-none tracking-normal',
          PLATE_SIZE[size],
          STATUS_CLASS[rank.status],
        )}
      >
        {rank.glyph}
      </span>
      {showLabel ? (
        <span aria-hidden className={cx('type-eyebrow', LABEL_CLASS[rank.status])}>
          {rank.label}
        </span>
      ) : null}
    </span>
  );
}
