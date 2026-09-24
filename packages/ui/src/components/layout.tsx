import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface PageHeaderProps {
  /** Location in the IA, e.g. "PEOPLE". Rendered as a mono eyebrow. */
  eyebrow?: ReactNode;
  /** Uppercase Orbitron title. Keep it to one or two words. */
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Secondary facts under the description (counts, timestamps). */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        'flex flex-col gap-5 border-b border-line-subtle pb-7 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-2.5">
        {eyebrow ? <p className="type-eyebrow text-fg-subtle">{eyebrow}</p> : null}
        <h1 className="type-title break-words text-fg">{title}</h1>
        {description ? <p className="max-w-2xl text-body text-fg-subtle">{description}</p> : null}
        {meta ? <div className="flex flex-wrap items-center gap-3 pt-1">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  level?: 2 | 3;
  id?: string;
}

export function SectionHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  level = 2,
  id,
}: SectionHeaderProps) {
  const Heading = `h${level}` as const;
  return (
    <div className={cx('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="type-eyebrow text-fg-subtle">{eyebrow}</p> : null}
        <Heading id={id} className="type-heading text-fg">
          {title}
        </Heading>
        {description ? <p className="text-small text-fg-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Horizontal control row (filters, search, bulk actions). Wraps on narrow screens. */
export function Toolbar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="toolbar" className={cx('flex flex-wrap items-end gap-3', className)} {...rest} />
  );
}

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** Optional centred label, e.g. "OR". */
  label?: string;
  className?: string;
}

export function Divider({ orientation = 'horizontal', label, className }: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        className={cx('inline-block h-4 w-px self-center bg-line', className)}
      />
    );
  }
  if (label) {
    return (
      <div role="separator" className={cx('flex items-center gap-3', className)}>
        <span className="h-px flex-1 bg-line" />
        <span className="type-eyebrow text-fg-subtle">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <hr className={cx('border-0 border-t border-line', className)} />;
}

export interface MonoProps extends HTMLAttributes<HTMLSpanElement> {
  /** Dimmer for secondary identifiers. */
  dim?: boolean;
}

/** Data voice: IDs, timestamps, codes. Tabular numerals, never uppercase-transformed. */
export function Mono({ dim, className, ...rest }: MonoProps) {
  return (
    <span
      className={cx('type-data', dim ? 'text-fg-subtle' : 'text-fg-muted', className)}
      {...rest}
    />
  );
}

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface-raised px-1 font-mono text-[11px] text-fg-muted shadow-sm',
        className,
      )}
      {...rest}
    />
  );
}
