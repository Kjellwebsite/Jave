import { useId } from 'react';
import {
  EMBLEM_LEFT_FACETS,
  EMBLEM_RIGHT_FACETS,
  EMBLEM_SILHOUETTE,
  EMBLEM_VIEWBOX,
} from '@jave/brand';
import { cx } from '../lib/cx';

export const EMBLEM_SIZES = { xs: 16, sm: 20, md: 28, lg: 40, xl: 64, '2xl': 96 } as const;
export type EmblemSize = keyof typeof EMBLEM_SIZES;

/** Two-tone metal: lit left facets, shaded right facets. */
const LIT_STOPS = ['#FFFFFF', '#D9DCE0', '#B8BDC3'] as const;
const SHADED_STOPS = ['#9CA1A8', '#737981', '#4A4F55'] as const;

export interface EmblemProps {
  size?: EmblemSize | number;
  /** `metallic` (default) for identity moments; `mono` inherits currentColor. */
  variant?: 'metallic' | 'mono';
  /** Accessible name. Omit when the emblem sits next to the wordmark. */
  title?: string;
  className?: string;
}

/** The JAVELIN emblem. Geometry comes from @jave/brand and is never altered here. */
export function Emblem({ size = 'md', variant = 'metallic', title, className }: EmblemProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const px = typeof size === 'number' ? size : EMBLEM_SIZES[size];
  const a11y = title
    ? ({ role: 'img', 'aria-label': title } as const)
    : ({ 'aria-hidden': true } as const);

  if (variant === 'mono') {
    return (
      <svg
        viewBox={EMBLEM_VIEWBOX}
        width={px}
        height={px}
        className={cx('shrink-0', className)}
        {...a11y}
      >
        <path d={EMBLEM_SILHOUETTE} fill="currentColor" />
      </svg>
    );
  }

  const lit = `${id}-lit`;
  const shaded = `${id}-shaded`;
  return (
    <svg
      viewBox={EMBLEM_VIEWBOX}
      width={px}
      height={px}
      className={cx('shrink-0', className)}
      {...a11y}
    >
      <defs>
        <linearGradient id={lit} x1="0" y1="0" x2="0.35" y2="1">
          {LIT_STOPS.map((color, index) => (
            <stop key={color} offset={index / (LIT_STOPS.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
        <linearGradient id={shaded} x1="1" y1="0" x2="0.65" y2="1">
          {SHADED_STOPS.map((color, index) => (
            <stop key={color} offset={index / (SHADED_STOPS.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {EMBLEM_LEFT_FACETS.map((d) => (
        <path key={d} d={d} fill={`url(#${lit})`} />
      ))}
      {EMBLEM_RIGHT_FACETS.map((d) => (
        <path key={d} d={d} fill={`url(#${shaded})`} />
      ))}
    </svg>
  );
}

export interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const WORDMARK_SIZES = {
  sm: 'text-[12px] tracking-[0.34em]',
  md: 'text-[15px] tracking-[0.36em]',
  lg: 'text-[28px] tracking-[0.34em]',
} as const;

/** JAVELIN in Orbitron with wide tracking. The trailing tracking is trimmed optically. */
export function Wordmark({ size = 'md', className }: WordmarkProps) {
  return (
    <span
      className={cx(
        'inline-block font-display font-semibold uppercase leading-none text-fg [margin-right:-0.34em]',
        WORDMARK_SIZES[size],
        className,
      )}
    >
      JAVELIN
    </span>
  );
}
