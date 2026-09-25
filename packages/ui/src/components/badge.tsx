import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line-strong text-fg-muted',
  success: 'border-success/35 bg-success/8 text-success',
  warning: 'border-warning/35 bg-warning/8 text-warning',
  danger: 'border-danger/35 bg-danger/8 text-danger',
  info: 'border-info/35 bg-info/8 text-info',
  accent: 'border-accent-trial/40 bg-accent-trial/8 text-accent-trial',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children: ReactNode;
}

/** Compact uppercase label. For state, prefer StatusBadge (adds a status dot). */
export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        'type-eyebrow inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 leading-none',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-fg-faint',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent-trial',
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'children'> {
  label: ReactNode;
  /** Soft pulse for live states (respects reduced motion). */
  live?: boolean;
  /**
   * Borderless dot + label, for the expected/normal state of a column
   * (SUCCESS, IN GUILD). Reserve the outlined badge for states that need attention.
   */
  quiet?: boolean;
}

export function StatusBadge({
  tone = 'neutral',
  label,
  live = false,
  quiet = false,
  className,
  ...rest
}: StatusBadgeProps) {
  if (quiet) {
    return (
      <span
        className={cx(
          'type-eyebrow inline-flex h-5 shrink-0 items-center gap-1.5 text-fg-subtle',
          className,
        )}
        {...rest}
      >
        <span aria-hidden className={cx('size-1.5 rounded-full', DOT[tone])} />
        {label}
      </span>
    );
  }
  return (
    <Badge tone={tone} className={className} {...rest}>
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full', DOT[tone], live && 'motion-safe:animate-pulse')}
      />
      {label}
    </Badge>
  );
}
