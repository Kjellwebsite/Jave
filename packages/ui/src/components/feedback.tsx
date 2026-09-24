import type { ReactNode } from 'react';
import {
  CircleAlert,
  CircleCheck,
  Info,
  LockKeyhole,
  type LucideIcon,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import { cx } from '../lib/cx';
import { Icon } from './icon';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  /** The next step. An empty screen is an invitation to act. */
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-10' : 'px-6 py-16',
        className,
      )}
    >
      {icon ? (
        <span className="mb-4 inline-flex size-10 items-center justify-center rounded-md border border-line bg-surface-raised text-fg-subtle">
          <Icon icon={icon} size="lg" />
        </span>
      ) : null}
      <p className="type-eyebrow text-fg-muted">{title}</p>
      {description ? (
        <p className="mt-2 max-w-sm text-small text-fg-subtle">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Error reference (e.g. E-7K2Q9XHD) — matches the server log entry. */
  reference?: string | null;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = 'SOMETHING FAILED',
  description = 'This view could not be loaded. Try again; if it keeps failing, report the reference below.',
  reference,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <span className="mb-4 inline-flex size-10 items-center justify-center rounded-md border border-danger/35 bg-danger/8 text-danger">
        <Icon icon={OctagonAlert} size="lg" />
      </span>
      <p className="type-eyebrow text-fg">{title}</p>
      <p className="mt-2 max-w-md text-small text-fg-subtle">{description}</p>
      {reference ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-sm border border-line px-2 py-1">
          <span className="type-eyebrow text-fg-subtle">REF</span>
          <span className="type-data select-all text-small text-fg-muted">{reference}</span>
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export interface RestrictedStateProps {
  title?: string;
  description?: ReactNode;
  /** The capability the viewer lacks, shown in the data voice (e.g. canViewAuditLogs). */
  requirement?: string;
  action?: ReactNode;
  className?: string;
}

/** Calm refusal for views the actor may not open. Never an error, never a crash. */
export function RestrictedState({
  title = 'ACCESS RESTRICTED',
  description = 'Your current roles do not include access to this view. Ask a Core member if you need it.',
  requirement,
  action,
  className,
}: RestrictedStateProps) {
  return (
    <div
      role="status"
      className={cx('flex flex-col items-center justify-center px-6 py-20 text-center', className)}
    >
      <span className="mb-5 inline-flex size-11 items-center justify-center rounded-md border border-line-strong bg-surface-raised text-fg-muted">
        <Icon icon={LockKeyhole} size="lg" />
      </span>
      <p className="type-eyebrow text-fg">{title}</p>
      <p className="mt-2 max-w-md text-small text-fg-subtle">{description}</p>
      {requirement ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-sm border border-line px-2 py-1">
          <span className="type-eyebrow text-fg-subtle">REQUIRES</span>
          <span className="type-data text-small text-fg-muted">{requirement}</span>
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export interface SkeletonProps {
  className?: string;
}

/** Placeholder block. Size it like the content it stands in for. */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden className={cx('skeleton-shimmer block rounded-md', className)} />;
}

export interface LoadingStateProps {
  label?: string;
  rows?: number;
  className?: string;
}

const DEFAULT_SKELETON_ROWS = 5;

/** Row skeletons for lists and tables, announced once to assistive tech. */
export function LoadingState({
  label = 'Loading',
  rows = DEFAULT_SKELETON_ROWS,
  className,
}: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cx('space-y-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export type CalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const CALLOUT: Record<CalloutTone, { frame: string; icon: LucideIcon; iconClass: string }> = {
  neutral: { frame: 'border-line bg-surface-raised', icon: Info, iconClass: 'text-fg-subtle' },
  info: { frame: 'border-info/30 bg-info/6', icon: Info, iconClass: 'text-info' },
  success: {
    frame: 'border-success/30 bg-success/6',
    icon: CircleCheck,
    iconClass: 'text-success',
  },
  warning: {
    frame: 'border-warning/30 bg-warning/6',
    icon: TriangleAlert,
    iconClass: 'text-warning',
  },
  danger: { frame: 'border-danger/30 bg-danger/6', icon: CircleAlert, iconClass: 'text-danger' },
};

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Use `alert` for results the user just caused (errors, confirmations). */
  role?: 'status' | 'alert' | 'note';
}

export function Callout({ tone = 'neutral', title, children, className, role }: CalloutProps) {
  const style = CALLOUT[tone];
  return (
    <div
      role={role}
      className={cx('flex gap-3 rounded-md border px-4 py-3 text-small', style.frame, className)}
    >
      <Icon icon={style.icon} className={cx('mt-0.5', style.iconClass)} />
      <div className="min-w-0 space-y-1">
        {title ? <p className="type-eyebrow text-fg">{title}</p> : null}
        {children ? <div className="text-fg-muted">{children}</div> : null}
      </div>
    </div>
  );
}
